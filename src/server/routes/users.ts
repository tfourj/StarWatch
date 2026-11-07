import { hashPassword } from "better-auth/crypto";
import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthedEnv } from "../auth/middleware";
import { registerUser, RegistrationError, type Role } from "../auth/registration";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import { account, session, user } from "../db/schema";
import { HttpError, readJson } from "../lib/http";
import { logger } from "../logger";

const log = logger.child("users");

function findUser(id: string) {
  const row = getDb().select().from(user).where(eq(user.id, id)).get();
  if (!row) throw new HttpError(404, "User not found");
  return row;
}

function otherAdmins(excludeId: string) {
  return getDb()
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.role, "admin"), ne(user.id, excludeId)))
    .all().length;
}

function view(row: typeof user.$inferSelect, selfId: string) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    image: row.image,
    createdAt: row.createdAt,
    isSelf: row.id === selfId,
  };
}

export const users = new Hono<AuthedEnv>()
  .get("/", (c) => {
    const self = c.get("user").id;
    const rows = getDb().select().from(user).orderBy(user.createdAt).all();
    return c.json({ users: rows.map((r) => view(r, self)), allowRegistration: getConfig().allowRegistration });
  })
  .post("/", async (c) => {
    const body = await readJson<{ name?: string; email?: string; password?: string; role?: Role }>(c);
    try {
      const created = await registerUser(
        getDb(),
        { name: body.name ?? "", email: body.email ?? "", password: body.password ?? "" },
        { allowRegistration: true, createdByAdmin: true, role: body.role === "admin" ? "admin" : "user" },
      );
      log.info("user created by admin", { by: c.get("user").id, email: created.email, role: created.role });
      return c.json(view(findUser(created.id), c.get("user").id), 201);
    } catch (err) {
      if (err instanceof RegistrationError) throw new HttpError(err.code === "email_taken" ? 409 : 400, err.message);
      throw err;
    }
  })
  .patch("/:id", async (c) => {
    const target = findUser(c.req.param("id"));
    const { role, name } = await readJson<{ role?: Role; name?: string }>(c);
    const patch: Partial<typeof user.$inferInsert> = {};
    if (role !== undefined) {
      if (role !== "admin" && role !== "user") throw new HttpError(400, "Invalid role");
      if (role === "user" && target.role === "admin" && otherAdmins(target.id) === 0) {
        throw new HttpError(400, "At least one admin is required");
      }
      patch.role = role;
    }
    if (name !== undefined) {
      if (!name.trim()) throw new HttpError(400, "Name is required");
      patch.name = name.trim();
    }
    if (Object.keys(patch).length) getDb().update(user).set(patch).where(eq(user.id, target.id)).run();
    log.info("user updated", { by: c.get("user").id, id: target.id, ...patch });
    return c.json(view(findUser(target.id), c.get("user").id));
  })
  .post("/:id/password", async (c) => {
    const target = findUser(c.req.param("id"));
    const { password } = await readJson<{ password?: string }>(c);
    if (!password || password.length < 8 || password.length > 128) {
      throw new HttpError(400, "Password must be 8 to 128 characters");
    }
    const hash = await hashPassword(password);
    const db = getDb();
    db.transaction((tx) => {
      const credential = tx
        .select()
        .from(account)
        .where(and(eq(account.userId, target.id), eq(account.providerId, "credential")))
        .get();
      if (credential) {
        tx.update(account).set({ password: hash }).where(eq(account.id, credential.id)).run();
      } else {
        tx.insert(account)
          .values({ id: crypto.randomUUID(), accountId: target.id, providerId: "credential", userId: target.id, password: hash })
          .run();
      }
      // Sign the user out everywhere unless an admin resets their own password.
      if (target.id !== c.get("user").id) tx.delete(session).where(eq(session.userId, target.id)).run();
    });
    log.info("password reset", { by: c.get("user").id, id: target.id });
    return c.json({ ok: true });
  })
  .delete("/:id", (c) => {
    const target = findUser(c.req.param("id"));
    if (target.id === c.get("user").id) throw new HttpError(400, "You cannot delete your own account");
    if (target.role === "admin" && otherAdmins(target.id) === 0) throw new HttpError(400, "At least one admin is required");
    getDb().delete(user).where(eq(user.id, target.id)).run();
    log.info("user deleted", { by: c.get("user").id, id: target.id });
    return c.json({ ok: true });
  });
