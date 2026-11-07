import { optionalString, requireString, sendHttp } from "../http";
import type { NotificationProvider } from "../types";

export const pushover: NotificationProvider = {
  type: "pushover",
  async send(config, msg) {
    const form = new URLSearchParams({
      token: requireString(config, "apiToken"),
      user: requireString(config, "userKey"),
      title: msg.title,
      message: msg.body,
      url: msg.vars.repo_url,
      url_title: msg.vars.repo,
      priority: optionalString(config, "priority") ?? "0",
      timestamp: String(Math.floor(msg.occurredAt.getTime() / 1000)),
    });
    const device = optionalString(config, "device");
    const sound = optionalString(config, "sound");
    if (device) form.set("device", device);
    if (sound) form.set("sound", sound);
    await sendHttp("https://api.pushover.net/1/messages.json", { form });
  },
};
