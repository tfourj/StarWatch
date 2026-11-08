import { existsSync } from "node:fs";
import path from "node:path";
import nodemailer, { type SendMailOptions } from "nodemailer";
import { webDir } from "../../lib/web-dir";
import { optionalString, requireString } from "../http";
import { stripMarkup } from "../../../shared/templates";
import { escapeHtml, listLinks, toHtml, trailingLink } from "../links";
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
    ? `<p style="margin:12px 0 0"><a href="${escapeHtml(trailing.url)}">${escapeHtml(trailing.label)}</a></p>`
    : "";
  const header = showLogo
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:20px"><tr>` +
      `<td style="padding-right:8px;vertical-align:middle">` +
      `<img src="cid:${LOGO_CID}" width="24" height="24" alt="" style="display:block;border-radius:6px" /></td>` +
      `<td style="vertical-align:middle;font-size:14px;font-weight:600;color:#555">StarWatch</td>` +
      `</tr></table>`
    : "";
  const avatar = msg.kind === "star" && v.avatar
    ? `<td style="padding-right:16px;vertical-align:top;width:48px">` +
      `<img src="${escapeHtml(v.avatar)}" width="48" height="48" alt="" style="display:block;border-radius:50%" /></td>`
    : "";
  // URLs go below the message so the inbox preview shows only the text.
  const urls = (trailing ? [trailing] : listLinks(msg.body)).map((l) => `${l.label}: ${l.url}`).join("\n");
  const content =
    `<td style="vertical-align:top"><h2 style="margin:0 0 8px;font-size:20px">${escapeHtml(msg.title)}</h2>` +
    `<p style="margin:0">${toHtml(msg.body).replace(/\n/g, "<br>")}</p>${footer}</td>`;

  return {
    from: name ? { name, address } : address,
    to: requireString(config, "to"),
    subject: msg.title,
    text: [stripMarkup(msg.body), urls].filter(Boolean).join("\n\n"),
    html:
      `<div style="font-family:sans-serif">${header}` +
      `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${avatar}${content}</tr></table></div>`,
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
