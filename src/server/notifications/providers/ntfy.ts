import { stripMarkup } from "../../../shared/templates";
import { optionalString, requireString, sendHttp, trimSlash } from "../http";
import { listLinks, mainLink } from "../links";
import type { NotificationMessage, NotificationProvider } from "../types";

/** ntfy shows tags that match an emoji name as that emoji. */
function tag(msg: NotificationMessage) {
  if (msg.kind === "login") return "lock";
  if (msg.kind === "follow") return msg.action === "followed" ? "bust_in_silhouette" : "wave";
  return msg.action === "created" ? "star" : "broken_heart";
}

export const ntfy: NotificationProvider = {
  type: "ntfy",
  async send(config, msg) {
    const token = optionalString(config, "token");
    const actions = listLinks(msg.body)
      .slice(0, 3)
      .map((link) => ({ action: "view", label: link.label, url: link.url }));
    await sendHttp(trimSlash(optionalString(config, "serverUrl") ?? "https://ntfy.sh"), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      json: {
        topic: requireString(config, "topic"),
        title: msg.title,
        message: stripMarkup(msg.body),
        click: mainLink(config, msg)?.url,
        actions: actions.length ? actions : undefined,
        icon: (msg.kind !== "login" && msg.vars.avatar) || undefined,
        tags: [tag(msg)],
        priority: Number(optionalString(config, "priority") ?? 3),
      },
    });
  },
};
