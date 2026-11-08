import nodemailer from "nodemailer";
import { optionalString, requireString } from "../http";
import { escapeHtml, toHtml, toPlainWithUrls, trailingLink } from "../links";
import { DeliveryError, type NotificationProvider } from "../types";

export const email: NotificationProvider = {
  type: "email",
  async send(config, msg) {
    const username = optionalString(config, "username");
    const transport = nodemailer.createTransport({
      host: requireString(config, "host"),
      port: Number(config.port ?? 587),
      secure: config.secure === true || config.secure === "true",
      auth: username ? { user: username, pass: optionalString(config, "password") ?? "" } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    const v = msg.vars;
    const trailing = trailingLink(config, msg);
    const footer = trailing
      ? `<p><a href="${escapeHtml(trailing.url)}">${escapeHtml(trailing.label)}</a></p>`
      : "";
    const avatar = v.avatar ? `<img src="${escapeHtml(v.avatar)}" width="48" height="48" style="border-radius:50%" />` : "";
    try {
      await transport.sendMail({
        from: requireString(config, "from"),
        to: requireString(config, "to"),
        subject: msg.title,
        text: toPlainWithUrls(msg.body) + (trailing ? `\n\n${trailing.url}` : ""),
        html:
          `<div style="font-family:sans-serif">${avatar}<h2>${escapeHtml(msg.title)}</h2>` +
          `<p>${toHtml(msg.body).replace(/\n/g, "<br>")}</p>${footer}</div>`,
      });
    } catch (err) {
      throw new DeliveryError(`SMTP error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      transport.close();
    }
  },
};
