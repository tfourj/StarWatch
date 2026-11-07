import { optionalString, requireString, sendHttp } from "../http";
import type { NotificationProvider } from "../types";

export const discord: NotificationProvider = {
  type: "discord",
  async send(config, msg) {
    await sendHttp(requireString(config, "webhookUrl"), {
      json: {
        username: optionalString(config, "username") ?? "StarWatch",
        embeds: [
          {
            title: msg.title,
            description: msg.body,
            url: msg.vars.repo_url,
            color: msg.action === "created" ? 0xf5c518 : 0x9ca3af,
            author: { name: msg.vars.user, url: msg.vars.user_url, icon_url: msg.vars.avatar || undefined },
            thumbnail: msg.vars.avatar ? { url: msg.vars.avatar } : undefined,
            timestamp: msg.occurredAt.toISOString(),
            footer: { text: `${msg.vars.stars} stars` },
          },
        ],
      },
    });
  },
};
