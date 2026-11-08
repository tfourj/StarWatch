import { optionalString, requireString, sendHttp } from "../http";
import { mainLink, toHtml } from "../links";
import type { NotificationProvider } from "../types";

export const pushover: NotificationProvider = {
  type: "pushover",
  async send(config, msg) {
    const form = new URLSearchParams({
      token: requireString(config, "apiToken"),
      user: requireString(config, "userKey"),
      title: msg.title,
      message: toHtml(msg.body),
      html: "1",
      priority: optionalString(config, "priority") ?? "0",
      timestamp: String(Math.floor(msg.occurredAt.getTime() / 1000)),
    });
    const link = mainLink(config, msg);
    if (link) {
      form.set("url", link.url);
      form.set("url_title", link.label);
    }
    const device = optionalString(config, "device");
    const sound = optionalString(config, "sound");
    if (device) form.set("device", device);
    if (sound) form.set("sound", sound);
    await sendHttp("https://api.pushover.net/1/messages.json", { form });
  },
};
