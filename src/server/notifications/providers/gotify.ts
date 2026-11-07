import { optionalString, requireString, sendHttp, trimSlash } from "../http";
import type { NotificationProvider } from "../types";

export const gotify: NotificationProvider = {
  type: "gotify",
  async send(config, msg) {
    await sendHttp(`${trimSlash(requireString(config, "serverUrl"))}/message`, {
      headers: { "X-Gotify-Key": requireString(config, "appToken") },
      json: {
        title: msg.title,
        message: `${msg.body}\n${msg.vars.repo_url}`,
        priority: Number(optionalString(config, "priority") ?? 5),
        extras: { "client::notification": { click: { url: msg.vars.repo_url } } },
      },
    });
  },
};
