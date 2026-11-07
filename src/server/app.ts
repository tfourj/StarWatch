import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { getAuth } from "./auth/auth";
import { requireAdmin, requireAuth, sessionMiddleware, type AppEnv, type AuthedEnv } from "./auth/middleware";
import { countUsers } from "./auth/registration";
import { getConfig } from "./config";
import { getDb } from "./db/client";
import { HttpError } from "./lib/http";
import { logger } from "./logger";
import { channelRoutes } from "./routes/channels";
import { dashboard } from "./routes/dashboard";
import { events } from "./routes/events";
import { health } from "./routes/health";
import { repos } from "./routes/repos";
import { settingsRoutes } from "./routes/settings";
import { setup } from "./routes/setup";
import { users } from "./routes/users";
import { webhooks } from "./routes/webhooks";

const log = logger.child("http");

function webDir() {
  return path.resolve(process.env.WEB_DIR ?? "dist/web");
}

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

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    const started = Date.now();
    await next();
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
  authed.get("/me", (c) => c.json({ user: c.get("user") }));
  authed.route("/dashboard", dashboard);
  authed.route("/repos", repos);
  authed.route("/events", events);
  authed.route("/channels", channelRoutes);
  authed.route("/settings", settingsRoutes);
  authed.use("/users/*", requireAdmin);
  authed.use("/users", requireAdmin);
  authed.route("/users", users);
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
