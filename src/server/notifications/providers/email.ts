import nodemailer from "nodemailer";
import { optionalString, requireString } from "../http";
import { DeliveryError, type NotificationProvider } from "../types";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
    const avatar = v.avatar ? `<img src="${escapeHtml(v.avatar)}" width="48" height="48" style="border-radius:50%" />` : "";
    try {
      await transport.sendMail({
        from: requireString(config, "from"),
        to: requireString(config, "to"),
        subject: msg.title,
        text: `${msg.body}\n\n${v.repo_url}`,
        html:
          `<div style="font-family:sans-serif">${avatar}<h2>${escapeHtml(msg.title)}</h2>` +
          `<p>${escapeHtml(msg.body)}</p>` +
          `<p><a href="${escapeHtml(v.user_url)}">${escapeHtml(v.user)}</a> · ` +
          `<a href="${escapeHtml(v.repo_url)}">${escapeHtml(v.repo)}</a></p></div>`,
      });
    } catch (err) {
      throw new DeliveryError(`SMTP error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      transport.close();
    }
  },
};
