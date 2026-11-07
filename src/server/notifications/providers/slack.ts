import { requireString, sendHttp } from "../http";
import type { NotificationProvider } from "../types";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const slack: NotificationProvider = {
  type: "slack",
  async send(config, msg) {
    const text = `*${escape(msg.title)}*\n${escape(msg.body)}\n<${msg.vars.repo_url}|${escape(msg.vars.repo)}>`;
    await sendHttp(requireString(config, "webhookUrl"), {
      json: {
        text,
        unfurl_links: false,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text },
            ...(msg.vars.avatar
              ? { accessory: { type: "image", image_url: msg.vars.avatar, alt_text: msg.vars.user } }
              : {}),
          },
        ],
      },
    });
  },
};
