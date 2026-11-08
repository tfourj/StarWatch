import { existsSync } from "node:fs";
import path from "node:path";
import nodemailer, { type SendMailOptions } from "nodemailer";
import { webDir } from "../../lib/web-dir";
import { optionalString, requireString } from "../http";
import { escapeHtml, toHtml, toPlainWithUrls, trailingLink } from "../links";
import { DeliveryError, type ChannelConfig, type NotificationMessage, type NotificationProvider } from "../types";

const LOGO_CID = "starwatch-logo";

/** The app icon from the built frontend, or null when it is missing (for example in development). */
function logoFile(): string | null {
  const file = path.join(webDir(), "icon-192.png");
  return existsSync(file) ? file : null;
}

/** Build the message. `logo` is the icon file to embed, or null to leave it out. */
export function buildMail(config: ChannelConfig, msg: NotificationMessage, logo: string | null): SendMailOptions {
  const address = requireString(config, "from");
  const name = optionalString(config, "fromName");
  const showLogo = config.showLogo !== false && config.showLogo !== "false" && logo !== null;

  const v = msg.vars;
  const trailing = trailingLink(config, msg);
  const footer = trailing
    ? `<p><a href="${escapeHtml(trailing.url)}">${escapeHtml(trailing.label)}</a></p>`
    : "";
  const header = showLogo
    ? `<img src="cid:${LOGO_CID}" width="40" height="40" alt="StarWatch" style="display:block;margin-bottom:16px" />`
    : "";
  const avatar = msg.kind === "star" && v.avatar
    ? `<img src="${escapeHtml(v.avatar)}" width="48" height="48" style="border-radius:50%" />`
    : "";

  return {
    from: name ? { name, address } : address,
    to: requireString(config, "to"),
    subject: msg.title,
    text: toPlainWithUrls(msg.body) + (trailing ? `\n\n${trailing.url}` : ""),
    html:
      `<div style="font-family:sans-serif">${header}${avatar}<h2>${escapeHtml(msg.title)}</h2>` +
      `<p>${toHtml(msg.body).replace(/\n/g, "<br>")}</p>${footer}</div>`,
    attachments: showLogo ? [{ filename: "starwatch.png", path: logo, cid: LOGO_CID }] : undefined,
  };
}

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
    try {
      await transport.sendMail(buildMail(config, msg, logoFile()));
    } catch (err) {
      throw new DeliveryError(`SMTP error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      transport.close();
    }
  },
};
