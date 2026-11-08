import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { IS_DEMO } from "@/lib/env";

const options = { baseURL: window.location.origin, basePath: "/api/auth", plugins: [twoFactorClient()] };

type AuthClient = ReturnType<typeof createAuthClient<typeof options>>;

const notInDemo = async () => ({ data: null, error: { message: "Not available in the demo.", status: 400 } });

/** The demo has no auth server; account actions explain that instead of failing on a network error. */
const demoAuthClient = {
  signIn: { email: notInDemo, social: notInDemo },
  signOut: notInDemo,
  updateUser: notInDemo,
  changePassword: notInDemo,
  twoFactor: {
    enable: notInDemo,
    disable: notInDemo,
    verifyTotp: notInDemo,
    verifyBackupCode: notInDemo,
    generateBackupCodes: notInDemo,
  },
} as unknown as AuthClient;

export const authClient: AuthClient = IS_DEMO
  ? demoAuthClient
  : createAuthClient(options);
