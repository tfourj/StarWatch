import { optionalString, requireString, sendHttp } from "../http";
import { mainLink } from "../links";
import type { LoginMessage, NotificationMessage, NotificationProvider } from "../types";

function color(msg: NotificationMessage) {
  if (msg.kind === "login") return 0x3b82f6;
  if (msg.kind === "follow") return msg.action === "followed" ? 0x2ea043 : 0x9ca3af;
  return msg.action === "created" ? 0xf5c518 : 0x9ca3af;
}

function footer(msg: Exclude<NotificationMessage, LoginMessage>) {
  return msg.kind === "follow" ? `${msg.followers} followers` : `${msg.vars.stars} stars`;
}

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
            color: color(msg),
            timestamp: msg.occurredAt.toISOString(),
            ...(msg.kind !== "login"
              ? {
                  author: { name: msg.vars.user, url: msg.vars.user_url, icon_url: msg.vars.avatar || undefined },
                  thumbnail: msg.vars.avatar ? { url: msg.vars.avatar } : undefined,
                  footer: { text: footer(msg) },
                }
              : {}),
          },
        ],
      },
    });
  },
};
