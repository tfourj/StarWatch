import { formatLinks } from "../../../shared/templates";
import { requireString, sendHttp } from "../http";
import { trailingLink } from "../links";
import type { NotificationProvider } from "../types";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const link = (text: string, url: string) => `<${url}|${escape(text)}>`;

export const slack: NotificationProvider = {
  type: "slack",
  async send(config, msg) {
    const trailing = trailingLink(config, msg);
    const body = formatLinks(msg.body, { text: escape, link });
    const text = `*${escape(msg.title)}*\n${body}${trailing ? `\n${link(trailing.label, trailing.url)}` : ""}`;
    await sendHttp(requireString(config, "webhookUrl"), {
      json: {
        text,
        unfurl_links: false,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text },
            ...(msg.kind === "star" && msg.vars.avatar
              ? { accessory: { type: "image", image_url: msg.vars.avatar, alt_text: msg.vars.user } }
              : {}),
          },
        ],
      },
    });
  },
};
