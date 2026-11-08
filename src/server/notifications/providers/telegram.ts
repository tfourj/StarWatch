import { optionalString, requireString, sendHttp } from "../http";
import { escapeHtml, toHtml, trailingLink } from "../links";
import { DeliveryError, type NotificationProvider } from "../types";

export const telegram: NotificationProvider = {
  type: "telegram",
  async send(config, msg) {
    const token = requireString(config, "botToken");
    if (!/^\d+:[\w-]+$/.test(token)) throw new DeliveryError("Bot token looks invalid");
    const threadId = optionalString(config, "threadId");
    const trailing = trailingLink(config, msg);
    const footer = trailing ? `\n<a href="${escapeHtml(trailing.url)}">${escapeHtml(trailing.label)}</a>` : "";
    await sendHttp(`https://api.telegram.org/bot${token}/sendMessage`, {
      json: {
        chat_id: requireString(config, "chatId"),
        message_thread_id: threadId ? Number(threadId) : undefined,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        text: `<b>${escapeHtml(msg.title)}</b>\n${toHtml(msg.body)}${footer}`,
      },
    });
  },
};
