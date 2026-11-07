import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getDb } from "../db/client";
import { user } from "../db/schema";
import { getAuth } from "./auth";
import type { Role } from "./registration";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
}

export type AppEnv = { Variables: { user: CurrentUser | null } };
export type AuthedEnv = { Variables: { user: CurrentUser } };

/** Loads the session and re-reads the user row so role changes apply immediately. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const result = await getAuth().api.getSession({ headers: c.req.raw.headers });
  let current: CurrentUser | null = null;
  if (result?.user) {
    const row = getDb().select().from(user).where(eq(user.id, result.user.id)).get();
    if (row) current = { id: row.id, name: row.name, email: row.email, image: row.image, role: row.role };
  }
  c.set("user", current);
  await next();
});

export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

export const requireAdmin = createMiddleware<AuthedEnv>(async (c, next) => {
  const current = c.get("user");
  if (!current) return c.json({ error: "Unauthorized" }, 401);
  if (current.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  await next();
});
