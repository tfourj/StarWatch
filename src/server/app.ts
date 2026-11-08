import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { getAuth } from "./auth/auth";
import { requireAdmin, requireAuth, sessionMiddleware, type AppEnv, type AuthedEnv } from "./auth/middleware";
import { countUsers } from "./auth/registration";
import { getConfig } from "./config";
import { getDb } from "./db/client";
import { HttpError } from "./lib/http";
import { webDir } from "./lib/web-dir";
import { logger } from "./logger";
import { channelRoutes } from "./routes/channels";
import { dashboard } from "./routes/dashboard";
import { events } from "./routes/events";
import { health } from "./routes/health";
import { logs } from "./routes/logs";
import { me } from "./routes/me";
import { repos } from "./routes/repos";
import { security } from "./routes/security";
import { settingsRoutes } from "./routes/settings";
import { setup } from "./routes/setup";
import { users } from "./routes/users";
import { webhooks } from "./routes/webhooks";

const log = logger.child("http");

/** Serve the built SPA. Unknown paths get index.html; first-run and registration redirects happen here too. */
function staticHandler() {
  const root = webDir();
  const indexFile = path.join(root, "index.html");

  return async (c: import("hono").Context) => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    const filePath = path.normalize(path.join(root, pathname));

    if (filePath.startsWith(root + path.sep) && existsSync(filePath) && statSync(filePath).isFile()) {
      const immutable = pathname.startsWith("/assets/");
      return new Response(Bun.file(filePath), {
        headers: { "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300" },
      });
    }

    if (path.extname(pathname)) return c.text("Not found", 404);

    const needsSetup = countUsers(getDb()) === 0;
    if (needsSetup && pathname !== "/register") return c.redirect("/register", 302);
    if (!needsSetup && pathname === "/register" && !getConfig().allowRegistration) return c.redirect("/login", 302);

    if (!existsSync(indexFile)) return c.text("Frontend not built. Run `bun run build:web`.", 503);
    return new Response(Bun.file(indexFile), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
    });
  };
}

/** Serves only the GitHub webhook receiver, so a tunnel never exposes the UI or API. */
export function createWebhookApp() {
  const app = new Hono();
  app.route("/api/webhooks", webhooks);
  app.all("*", (c) => c.json({ error: "Not found" }, 404));
  app.onError((err, c) => {
    log.error("unhandled webhook error", { path: c.req.path, err });
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    const started = Date.now();
    await next();
    // The Logs page and healthcheck poll constantly; logging them would bury everything else.
    if (c.req.path === "/api/logs" || c.req.path === "/api/health") return;
    const level = c.res.status >= 500 && c.res.status !== 502 ? "error" : c.res.status >= 400 ? "warn" : "debug";
    log[level]("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  app.route("/api/health", health);
  app.route("/api/webhooks", webhooks);
  app.on(["GET", "POST"], "/api/auth/*", (c) => getAuth().handler(c.req.raw));

  app.use("/api/*", sessionMiddleware);
  app.route("/api/setup", setup);

  const authed = new Hono<AuthedEnv>();
  authed.use("*", requireAuth);
  authed.route("/me", me);
  authed.route("/dashboard", dashboard);
  authed.route("/repos", repos);
  authed.route("/events", events);
  authed.route("/channels", channelRoutes);
  authed.route("/settings", settingsRoutes);
  authed.route("/security", security);
  authed.use("/users/*", requireAdmin);
  authed.use("/users", requireAdmin);
  authed.route("/users", users);
  authed.use("/logs", requireAdmin);
  authed.route("/logs", logs);
  app.route("/api", authed as unknown as Hono<AppEnv>);

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  app.get("*", staticHandler());

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    log.error("unhandled error", { path: c.req.path, err });
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
