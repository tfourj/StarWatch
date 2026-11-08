import { stripLinks } from "../../../shared/templates";
import { optionalString, requireString, sendHttp, trimSlash } from "../http";
import { listLinks, mainLink } from "../links";
import type { NotificationProvider } from "../types";

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
        message: stripLinks(msg.body),
        click: mainLink(config, msg)?.url,
        actions: actions.length ? actions : undefined,
        icon: msg.vars.avatar || undefined,
        tags: [msg.action === "created" ? "star" : "broken_heart"],
        priority: Number(optionalString(config, "priority") ?? 3),
      },
    });
  },
};
