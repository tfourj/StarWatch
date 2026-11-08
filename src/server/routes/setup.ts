import { Hono } from "hono";
import { getAuth } from "../auth/auth";
import type { AppEnv } from "../auth/middleware";
import { countUsers, registerUser, RegistrationError } from "../auth/registration";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import { readJson } from "../lib/http";
import { logger } from "../logger";
import { VERSION } from "../lib/build-info";

const log = logger.child("setup");

export const setup = new Hono<AppEnv>()
  .get("/status", (c) => {
    const config = getConfig();
    const needsSetup = countUsers(getDb()) === 0;
    return c.json({
      needsSetup,
      registrationOpen: needsSetup || config.allowRegistration,
      githubOAuth: Boolean(config.github),
      version: VERSION,
    });
  })
  .post("/register", async (c) => {
    const body = await readJson<{ name?: string; email?: string; password?: string }>(c);
    try {
      const created = await registerUser(
        getDb(),
        { name: body.name ?? "", email: body.email ?? "", password: body.password ?? "" },
        { allowRegistration: getConfig().allowRegistration },
      );
      log.info(created.isFirstUser ? "first user registered as admin" : "user registered", {
        email: created.email,
        role: created.role,
      });
      // Sign the new user in; the response carries the session cookie.
      const response = await getAuth().api.signInEmail({
        body: { email: created.email, password: body.password! },
        headers: c.req.raw.headers,
        asResponse: true,
      });
      return response;
    } catch (err) {
      if (err instanceof RegistrationError) {
        const status = err.code === "closed" ? 403 : err.code === "email_taken" ? 409 : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      throw err;
    }
  });
