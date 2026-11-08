import { and, eq, inArray } from "drizzle-orm";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import { channels, user, type Channel } from "../db/schema";
import { formatEventTime } from "../lib/template";
import { describeUserAgent } from "../lib/user-agent";
import { logger } from "../logger";
import { sendToChannel } from "../notifications/worker";
import type { LoginDetails, LoginMessage } from "../notifications/types";
import { getUserSettings, getUserTimeFormat, updateUserSettings } from "./settings";

const log = logger.child("login-alerts");

export interface SignIn {
  userId: string;
  method: string;
  ip: string | null;
  userAgent: string | null;
  at: Date;
}

export interface LoginAlertResult {
  channelId: number;
  name: string;
  ok: boolean;
  error: string | null;
}

/** Delays before each retry. Tests set this to zeros. */
export const loginAlertRetry = { delaysMs: [5_000, 30_000] };

function ownedChannels(userId: string, ids: number[]): Channel[] {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(channels)
    .where(and(eq(channels.userId, userId), inArray(channels.id, ids)))
    .orderBy(channels.name)
    .all();
}

/** Selected channel ids that still exist and belong to the user. */
export function getLoginAlertChannelIds(userId: string): number[] {
  const stored = getUserSettings(userId).loginAlertChannels ?? [];
  return ownedChannels(userId, stored).map((c) => c.id);
}

/** Store the selection. Ids that are not the user's channels are dropped. */
export function setLoginAlertChannelIds(userId: string, ids: number[]): number[] {
  const wanted = [...new Set(ids.map(Number).filter(Number.isInteger))];
  const kept = ownedChannels(userId, wanted).map((c) => c.id);
  updateUserSettings(userId, { loginAlertChannels: kept.length ? kept : null });
  return kept;
}

export function buildLoginMessage(
  details: LoginDetails,
  at: Date,
  isTest = false,
  format: ReturnType<typeof getUserTimeFormat> = { timeZone: getConfig().timezone, timeFormat: "auto" },
): LoginMessage {
  const config = getConfig();
  const time = formatEventTime(at, format.timeZone, format.timeFormat);
  const link = { url: `${config.baseUrl.replace(/\/+$/, "")}/settings?tab=security`, label: "Security settings" };
  const lines = [
    `${details.name} (${details.email}) signed in to StarWatch.`,
    "",
    `Method: ${details.method}`,
    `Device: ${details.device}`,
    `IP address: ${details.ip ?? "unknown"}`,
    `Time: ${time}`,
    "",
    "If this was not you, change your password and turn on two-factor authentication.",
  ];
  return {
    kind: "login",
    title: `${isTest ? "[Test] " : ""}New sign-in to StarWatch`,
    body: lines.join("\n"),
    vars: {
      user: details.name,
      user_url: link.url,
      avatar: "",
      repo: "",
      repo_url: "",
      stars: "",
      action: "signed in",
      time,
    },
    occurredAt: at,
    isTest,
    login: details,
    link,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendWithRetry(channel: Channel, message: LoginMessage, retry: boolean): Promise<string | null> {
  const delays = retry ? loginAlertRetry.delaysMs : [];
  for (let attempt = 0; ; attempt++) {
    try {
      await sendToChannel(channel, message);
      return null;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (attempt >= delays.length) return error;
      await sleep(delays[attempt]!);
    }
  }
}

/**
 * Send a login alert to every selected, enabled channel.
 * Real alerts retry a few times in the background; tests send once so the result can be shown right away.
 */
export async function sendLoginAlerts(signIn: SignIn, options: { test?: boolean; channelIds?: number[] } = {}) {
  const account = getDb().select().from(user).where(eq(user.id, signIn.userId)).get();
  if (!account) return [];
  const ids = options.channelIds ?? getLoginAlertChannelIds(signIn.userId);
  const targets = ownedChannels(signIn.userId, ids).filter((c) => c.enabled);
  if (targets.length === 0) return [];

  const details: LoginDetails = {
    name: account.name,
    email: account.email,
    method: signIn.method,
    ip: signIn.ip,
    device: describeUserAgent(signIn.userAgent),
    userAgent: signIn.userAgent,
  };
  const message = buildLoginMessage(details, signIn.at, options.test, getUserTimeFormat(signIn.userId));

  return Promise.all(
    targets.map(async (channel): Promise<LoginAlertResult> => {
      const error = await sendWithRetry(channel, message, !options.test);
      const meta = { userId: signIn.userId, channel: channel.name, type: channel.type };
      if (error) log.warn("login alert failed", { ...meta, error });
      else log.info("login alert sent", meta);
      return { channelId: channel.id, name: channel.name, ok: error === null, error };
    }),
  );
}

/** Fire and forget from the sign-in hook, so a slow channel never delays the login. */
export function queueLoginAlerts(signIn: SignIn) {
  if (getLoginAlertChannelIds(signIn.userId).length === 0) return;
  void sendLoginAlerts(signIn).catch((err) => log.error("login alerts error", { err }));
}
