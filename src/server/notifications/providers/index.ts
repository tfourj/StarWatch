import type { NotificationProvider } from "../types";
import { discord } from "./discord";
import { email } from "./email";
import { gotify } from "./gotify";
import { ntfy } from "./ntfy";
import { pushover } from "./pushover";
import { slack } from "./slack";
import { telegram } from "./telegram";
import { webhook } from "./webhook";

const providers = new Map<string, NotificationProvider>(
  [discord, telegram, ntfy, gotify, slack, pushover, email, webhook].map((p) => [p.type, p]),
);

export function getProvider(type: string): NotificationProvider | undefined {
  return providers.get(type);
}

/** Tests can swap in a fake provider. */
export function registerProvider(provider: NotificationProvider) {
  providers.set(provider.type, provider);
}
