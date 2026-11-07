import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { openDatabase, type DB } from "../src/server/db/client";
import { account, user } from "../src/server/db/schema";
import {
  createUserWithPasswordHash,
  registerUser,
  RegistrationError,
  validateRegistration,
} from "../src/server/auth/registration";
import { createTestDb } from "./helpers";

let ctx: ReturnType<typeof createTestDb>;
let db: DB;

beforeEach(() => {
  ctx = createTestDb();
  db = ctx.db;
});
afterEach(() => ctx.cleanup());

const input = (n: number) => ({ name: `User ${n}`, email: `user${n}@example.com`, password: "password123" });

describe("first user becomes admin", () => {
  test("the first registration is admin and gets a credential account", async () => {
    const created = await registerUser(db, input(1), { allowRegistration: false });
    expect(created.role).toBe("admin");
    expect(created.isFirstUser).toBe(true);
    const acc = db.select().from(account).where(eq(account.userId, created.id)).get();
    expect(acc?.providerId).toBe("credential");
    expect(acc?.password).toBeTruthy();
    expect(acc?.password).not.toBe("password123");
  });

  test("registration closes after the first user", async () => {
    await registerUser(db, input(1), { allowRegistration: false });
    await expect(registerUser(db, input(2), { allowRegistration: false })).rejects.toMatchObject({ code: "closed" });
  });

  test("ALLOW_REGISTRATION lets more users in as regular users", async () => {
    await registerUser(db, input(1), { allowRegistration: true });
    const second = await registerUser(db, input(2), { allowRegistration: true });
    expect(second.role).toBe("user");
  });

  test("admins can create users with a chosen role even when closed", async () => {
    await registerUser(db, input(1), { allowRegistration: false });
    const created = await registerUser(db, input(2), { allowRegistration: false, createdByAdmin: true, role: "admin" });
    expect(created.role).toBe("admin");
  });

  test("a self-registered user cannot ask for admin", async () => {
    await registerUser(db, input(1), { allowRegistration: true });
    const second = await registerUser(db, input(2), { allowRegistration: true, role: "admin" });
    expect(second.role).toBe("user");
  });

  test("duplicate emails are rejected case-insensitively", async () => {
    await registerUser(db, input(1), { allowRegistration: true });
    await expect(
      registerUser(db, { ...input(2), email: "USER1@example.com" }, { allowRegistration: true }),
    ).rejects.toMatchObject({ code: "email_taken" });
  });

  test("simultaneous registrations produce exactly one admin", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => registerUser(db, input(i), { allowRegistration: false })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const closed = results.filter(
      (r) => r.status === "rejected" && (r.reason as RegistrationError).code === "closed",
    );
    expect(ok).toHaveLength(1);
    expect(closed).toHaveLength(7);
    expect(db.select().from(user).all().filter((u) => u.role === "admin")).toHaveLength(1);
  });

  test("two connections racing on the same file still produce one admin", async () => {
    const other = openDatabase(ctx.file);
    try {
      const hash = "hash";
      const attempts = [db, other, db, other].map((conn, i) =>
        Promise.resolve().then(() =>
          createUserWithPasswordHash(
            conn,
            { name: `U${i}`, email: `race${i}@example.com`, passwordHash: hash },
            { allowRegistration: true },
          ),
        ),
      );
      const results = await Promise.all(attempts);
      expect(results.filter((r) => r.role === "admin")).toHaveLength(1);
      expect(results.filter((r) => r.isFirstUser)).toHaveLength(1);
    } finally {
      other.$client.close();
    }
  });
});

describe("validateRegistration", () => {
  test("normalizes email and trims name", () => {
    expect(validateRegistration({ name: " Ann ", email: " Ann@Example.COM ", password: "12345678" })).toEqual({
      name: "Ann",
      email: "ann@example.com",
      password: "12345678",
    });
  });

  test("rejects short passwords and bad emails", () => {
    expect(() => validateRegistration({ name: "a", email: "a@b.co", password: "short" })).toThrow(RegistrationError);
    expect(() => validateRegistration({ name: "a", email: "nope", password: "12345678" })).toThrow(RegistrationError);
  });
});
