import { formatMarkup, hasLinks, parseLinks } from "../../shared/templates";
import { optionalString } from "./http";
import type { ChannelConfig, NotificationMessage } from "./types";

export interface MainLink {
  url: string;
  label: string;
}

/** The channel's main link: the repository (default), the stargazer, or none. Login alerts link to settings. */
export function mainLink(config: ChannelConfig, msg: NotificationMessage): MainLink | null {
  const choice = optionalString(config, "mainLink") ?? "repo";
  if (choice === "none") return null;
  if (msg.kind === "login") return msg.link;
  if (choice === "user") return { url: msg.vars.user_url, label: msg.vars.user };
  return { url: msg.vars.repo_url, label: msg.vars.repo };
}

/** The main link to add below the message, only when the template has no links of its own. */
export function trailingLink(config: ChannelConfig, msg: NotificationMessage): MainLink | null {
  return hasLinks(msg.body) ? null : mainLink(config, msg);
}

/** Every distinct link in the text, in order. */
export function listLinks(text: string): MainLink[] {
  const seen = new Set<string>();
  const links: MainLink[] = [];
  for (const s of parseLinks(text)) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    links.push({ url: s.url, label: s.text });
  }
  return links;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Text with links as HTML anchors, everything else escaped. */
export function toHtml(text: string): string {
  return formatMarkup(text, {
    text: escapeHtml,
    link: (t, url) => `<a href="${escapeHtml(url)}">${escapeHtml(t)}</a>`,
  });
}

/** Text with each link written as "text (url)". */
export function toPlainWithUrls(text: string): string {
  return formatMarkup(text, { link: (t, url) => `${t} (${url})` });
}
