import { optionalString, requireString, sendHttp, trimSlash } from "../http";
import { mainLink, trailingLink } from "../links";
import type { NotificationProvider } from "../types";

/** Markdown joins single newlines, so end each line with two spaces to keep the breaks. */
const hardBreaks = (s: string) => s.replace(/\n/g, "  \n");

export const gotify: NotificationProvider = {
  type: "gotify",
  async send(config, msg) {
    const click = mainLink(config, msg);
    const trailing = trailingLink(config, msg);
    const message = hardBreaks(msg.body) + (trailing ? `  \n[${trailing.label}](${trailing.url})` : "");
    await sendHttp(`${trimSlash(requireString(config, "serverUrl"))}/message`, {
      headers: { "X-Gotify-Key": requireString(config, "appToken") },
      json: {
        title: msg.title,
        message,
        priority: Number(optionalString(config, "priority") ?? 5),
        extras: {
          "client::display": { contentType: "text/markdown" },
          ...(click ? { "client::notification": { click: { url: click.url } } } : {}),
        },
      },
    });
  },
};
