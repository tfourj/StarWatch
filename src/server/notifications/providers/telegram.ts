import { DeliveryError } from "../types";
import { optionalString, requireString, sendHttp } from "../http";
import type { NotificationProvider } from "../types";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const telegram: NotificationProvider = {
  type: "telegram",
  async send(config, msg) {
    const token = requireString(config, "botToken");
    if (!/^\d+:[\w-]+$/.test(token)) throw new DeliveryError("Bot token looks invalid");
    const threadId = optionalString(config, "threadId");
    await sendHttp(`https://api.telegram.org/bot${token}/sendMessage`, {
      json: {
        chat_id: requireString(config, "chatId"),
        message_thread_id: threadId ? Number(threadId) : undefined,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        text: `<b>${escapeHtml(msg.title)}</b>\n${escapeHtml(msg.body)}\n<a href="${escapeHtml(msg.vars.repo_url)}">${escapeHtml(msg.vars.repo)}</a>`,
      },
    });
  },
};
