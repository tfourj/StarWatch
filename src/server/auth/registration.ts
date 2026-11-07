import { hashPassword } from "better-auth/crypto";
import { count, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { account, user } from "../db/schema";

export type Role = "admin" | "user";

export class RegistrationError extends Error {
  constructor(
    public code: "closed" | "email_taken" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export interface RegistrationInput {
  name: string;
  email: string;
  password: string;
}

export interface RegistrationOptions {
  /** ALLOW_REGISTRATION: lets anyone sign up after the first user. */
  allowRegistration: boolean;
  /** Set when an admin creates the user from Settings. */
  createdByAdmin?: boolean;
  /** Role requested by an admin. Ignored for the first user, who is always admin. */
  role?: Role;
}

export interface CreatedUser {
  id: string;
  email: string;
  role: Role;
  isFirstUser: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function countUsers(db: DB): number {
  return db.select({ n: count() }).from(user).get()?.n ?? 0;
}

export function validateRegistration(input: RegistrationInput): RegistrationInput {
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const password = input.password ?? "";
  if (!name) throw new RegistrationError("invalid", "Name is required");
  if (!EMAIL_RE.test(email)) throw new RegistrationError("invalid", "A valid email is required");
  if (password.length < 8) throw new RegistrationError("invalid", "Password must be at least 8 characters");
  if (password.length > 128) throw new RegistrationError("invalid", "Password must be at most 128 characters");
  return { name, email, password };
}

/**
 * Inserts the user and credential account inside one IMMEDIATE transaction.
 * The user count is read under the write lock, so two concurrent registrations
 * can never both see an empty table and both become admin.
 */
export function createUserWithPasswordHash(
  db: DB,
  input: { name: string; email: string; passwordHash: string },
  options: RegistrationOptions,
): CreatedUser {
  return db.transaction(
    (tx) => {
      const existingUsers = tx.select({ n: count() }).from(user).get()?.n ?? 0;
      const isFirstUser = existingUsers === 0;

      if (!isFirstUser && !options.allowRegistration && !options.createdByAdmin) {
        throw new RegistrationError("closed", "Registration is closed");
      }

      const taken = tx.select({ id: user.id }).from(user).where(eq(user.email, input.email)).get();
      if (taken) throw new RegistrationError("email_taken", "An account with this email already exists");

      const role: Role = isFirstUser ? "admin" : options.createdByAdmin ? (options.role ?? "user") : "user";
      const id = crypto.randomUUID();
      const now = new Date();

      tx.insert(user)
        .values({ id, name: input.name, email: input.email, role, emailVerified: false, createdAt: now, updatedAt: now })
        .run();
      tx.insert(account)
        .values({
          id: crypto.randomUUID(),
          accountId: id,
          providerId: "credential",
          userId: id,
          password: input.passwordHash,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      return { id, email: input.email, role, isFirstUser };
    },
    { behavior: "immediate" },
  );
}

export async function registerUser(db: DB, input: RegistrationInput, options: RegistrationOptions) {
  const clean = validateRegistration(input);
  // Fail fast before the expensive hash; the transaction re-checks under lock.
  if (!options.allowRegistration && !options.createdByAdmin && countUsers(db) > 0) {
    throw new RegistrationError("closed", "Registration is closed");
  }
  const passwordHash = await hashPassword(clean.password);
  return createUserWithPasswordHash(db, { name: clean.name, email: clean.email, passwordHash }, options);
}
