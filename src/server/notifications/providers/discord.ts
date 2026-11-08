import { optionalString, requireString, sendHttp } from "../http";
import { mainLink } from "../links";
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
            url: mainLink(config, msg)?.url,
            color: msg.kind === "login" ? 0x3b82f6 : msg.action === "created" ? 0xf5c518 : 0x9ca3af,
            timestamp: msg.occurredAt.toISOString(),
            ...(msg.kind === "star"
              ? {
                  author: { name: msg.vars.user, url: msg.vars.user_url, icon_url: msg.vars.avatar || undefined },
                  thumbnail: msg.vars.avatar ? { url: msg.vars.avatar } : undefined,
                  footer: { text: `${msg.vars.stars} stars` },
                }
              : {}),
          },
        ],
      },
    });
  },
};
