import { optionalString, requireString, sendHttp } from "../http";
import { DeliveryError, type NotificationProvider } from "../types";

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  } catch {
    throw new DeliveryError("Headers must be a JSON object");
  }
}

export const webhook: NotificationProvider = {
  type: "webhook",
  async send(config, msg) {
    const v = msg.vars;
    await sendHttp(requireString(config, "url"), {
      method: optionalString(config, "method") === "PUT" ? "PUT" : "POST",
      headers: parseHeaders(optionalString(config, "headers")),
      json: {
        event: "star",
        action: msg.action,
        test: msg.isTest,
        title: msg.title,
        message: msg.body,
        repository: { full_name: v.repo, url: v.repo_url, stars: Number(v.stars) },
        user: { login: v.user, url: v.user_url, avatar_url: v.avatar },
        time: msg.occurredAt.toISOString(),
        vars: v,
      },
    });
  },
};
