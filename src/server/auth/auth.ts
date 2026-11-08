import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor as twoFactorPlugin } from "better-auth/plugins";
import type { AppConfig } from "../config";
import type { DB } from "../db/client";
import { account, session, twoFactor, user, verification } from "../db/schema";
import { logger } from "../logger";
import { countUsers } from "./registration";

const log = logger.child("auth");

export function createAuth(db: DB, config: AppConfig) {
  return betterAuth({
    appName: "StarWatch",
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    secret: config.betterAuthSecret,
    database: drizzleAdapter(db, { provider: "sqlite", schema: { user, session, account, verification, twoFactor } }),
    trustedOrigins: [config.baseUrl],
    emailAndPassword: {
      enabled: true,
      // Sign-ups go through /api/setup/register so the first-user check stays transactional.
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    socialProviders: config.github
      ? {
          github: {
            clientId: config.github.clientId,
            clientSecret: config.github.clientSecret,
            disableImplicitSignUp: !config.allowRegistration,
          },
        }
      : undefined,
    account: {
      accountLinking: { enabled: true, trustedProviders: ["github"] },
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "user", input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: config.baseUrl.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"] },
    },
    plugins: [
      // Authenticator app codes with single-use backup codes. Only password sign-ins ask for a code.
      twoFactorPlugin({ issuer: "StarWatch", backupCodeOptions: { amount: 10, length: 10 } }),
    ],
    databaseHooks: {
      user: {
        create: {
          // Only OAuth sign-ups reach this hook. The first admin must use the register page.
          before: async (data) => {
            const total = countUsers(db);
            if (total === 0 || !config.allowRegistration) {
              log.warn("blocked oauth sign-up", { email: data.email, reason: total === 0 ? "no admin yet" : "closed" });
              return false;
            }
            return { data: { ...data, role: "user" } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

export function initAuth(db: DB, config: AppConfig): Auth {
  instance = createAuth(db, config);
  return instance;
}

export function getAuth(): Auth {
  if (!instance) throw new Error("auth not initialized");
  return instance;
}
