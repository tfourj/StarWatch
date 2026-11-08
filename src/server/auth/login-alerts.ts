import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import type { SignIn } from "../services/login-alerts";

const PROVIDER_NAMES: Record<string, string> = { github: "GitHub" };

/** How a request signed the user in, or null when the path does not sign anyone in. */
export function signInMethod(path: string, twoFactorEnabled: boolean, providerId?: string): string | null {
  switch (path) {
    case "/sign-in/email":
      // A 2FA user only gets a session here when the device is trusted.
      return twoFactorEnabled ? "Password on a trusted device" : "Password";
    case "/two-factor/verify-totp":
      return "Password and authenticator app";
    case "/two-factor/verify-backup-code":
      return "Password and backup code";
    case "/two-factor/verify-otp":
      return "Password and one-time code";
    case "/callback/:id":
    case "/sign-in/social": {
      const id = providerId ?? "github";
      return PROVIDER_NAMES[id] ?? id;
    }
    default:
      return null;
  }
}

/**
 * Reports every completed sign-in. Must come after the two-factor plugin: its hook removes the
 * session of a password sign-in that still needs a code, so only finished sign-ins reach this one.
 */
export function loginAlertsPlugin(onSignIn: (signIn: SignIn) => void): BetterAuthPlugin {
  return {
    id: "login-alerts",
    hooks: {
      after: [
        {
          matcher: (ctx) => signInMethod(ctx.path ?? "", false) !== null,
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            // Turning on 2FA also issues a new session; the request then already has one.
            if (!created || ctx.context.session) return;
            const twoFactorEnabled = Boolean((created.user as { twoFactorEnabled?: boolean }).twoFactorEnabled);
            const provider = ctx.params?.id ?? (ctx.body as { provider?: unknown } | undefined)?.provider;
            const providerId = typeof provider === "string" ? provider : undefined;
            const method = signInMethod(ctx.path, twoFactorEnabled, providerId);
            if (!method) return;
            onSignIn({
              userId: created.user.id,
              method,
              ip: created.session.ipAddress ?? null,
              userAgent: created.session.userAgent ?? null,
              at: new Date(created.session.createdAt),
            });
          }),
        },
      ],
    },
  };
}
