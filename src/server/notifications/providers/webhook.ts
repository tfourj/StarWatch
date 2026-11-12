import { stripMarkup } from "../../../shared/templates";
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
    const common = {
      test: msg.isTest,
      title: msg.title,
      message: stripMarkup(msg.body),
      message_markdown: msg.body,
      time: msg.occurredAt.toISOString(),
    };
    const user = { login: v.user, url: v.user_url, avatar_url: v.avatar };
    let json: Record<string, unknown>;
    if (msg.kind === "login") {
      json = {
        event: "login",
        ...common,
        account: { name: msg.login.name, email: msg.login.email },
        login: {
          method: msg.login.method,
          ip: msg.login.ip,
          device: msg.login.device,
          user_agent: msg.login.userAgent,
        },
      };
    } else if (msg.kind === "follow") {
      json = {
        event: "follow",
        action: msg.action,
        ...common,
        account: { login: msg.account.login, url: msg.account.url, followers: msg.followers },
        user,
      };
    } else {
      json = {
        event: "star",
        action: msg.action,
        ...common,
        repository: { full_name: v.repo, url: v.repo_url, stars: Number(v.stars) },
        user,
        vars: v,
      };
    }
    await sendHttp(requireString(config, "url"), {
      method: optionalString(config, "method") === "PUT" ? "PUT" : "POST",
      headers: parseHeaders(optionalString(config, "headers")),
      json,
    });
  },
};
