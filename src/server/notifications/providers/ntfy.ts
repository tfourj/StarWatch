import { optionalString, requireString, sendHttp, trimSlash } from "../http";
import type { NotificationProvider } from "../types";

export const ntfy: NotificationProvider = {
  type: "ntfy",
  async send(config, msg) {
    const token = optionalString(config, "token");
    await sendHttp(trimSlash(optionalString(config, "serverUrl") ?? "https://ntfy.sh"), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      json: {
        topic: requireString(config, "topic"),
        title: msg.title,
        message: msg.body,
        click: msg.vars.repo_url,
        icon: msg.vars.avatar || undefined,
        tags: [msg.action === "created" ? "star" : "broken_heart"],
        priority: Number(optionalString(config, "priority") ?? 3),
      },
    });
  },
};
