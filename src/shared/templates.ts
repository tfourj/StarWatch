export const TEMPLATE_VARIABLES = [
  { name: "user", description: "GitHub login of the stargazer" },
  { name: "user_url", description: "Profile URL of the stargazer" },
  { name: "avatar", description: "Avatar URL of the stargazer" },
  { name: "repo", description: "Repository full name (owner/name)" },
  { name: "repo_url", description: "Repository URL" },
  { name: "stars", description: "Star count after the event" },
  { name: "action", description: "starred or unstarred" },
  { name: "time", description: "Event time in the server timezone" },
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]["name"];
export type TemplateVars = Record<TemplateVariable, string>;

export interface MessageTemplates {
  starTitle: string;
  starBody: string;
  unstarTitle: string;
  unstarBody: string;
}

export const DEFAULT_TEMPLATES: MessageTemplates = {
  starTitle: "New star on {repo}",
  starBody: "[{user}]({user_url}) starred [{repo}]({repo_url}). It now has {stars} stars.",
  unstarTitle: "Star removed from {repo}",
  unstarBody: "[{user}]({user_url}) unstarred [{repo}]({repo_url}). It now has {stars} stars.",
};

/** Replace {name} placeholders. Unknown placeholders are left untouched, {{ and }} escape braces. */
export function renderTemplate(template: string, vars: Partial<Record<string, string | number>>): string {
  return template
    .replace(/\{\{|\}\}|\{([a-z_]+)\}/g, (match, name: string | undefined) => {
      if (match === "{{") return "\u0000LB";
      if (match === "}}") return "\u0000RB";
      const value = name ? vars[name] : undefined;
      return value === undefined || value === null ? match : String(value);
    })
    .replace(/\u0000LB/g, "{")
    .replace(/\u0000RB/g, "}");
}

export interface TemplateSegment {
  text: string;
  url?: string;
}

const LINK_PATTERN = /\[([^[\]\n]+)\]\((https?:\/\/[^\s()]+)\)/g;

/** Split rendered text into plain and linked parts. Only [text](http or https URL) counts as a link. */
export function parseLinks(text: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    segments.push({ text: match[1], url: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

export function hasLinks(text: string): boolean {
  return parseLinks(text).some((s) => s.url);
}

/** Rebuild text with each part formatted, for example as HTML anchors or Slack links. */
export function formatLinks(
  text: string,
  format: { text?: (text: string) => string; link: (text: string, url: string) => string },
): string {
  const plain = format.text ?? ((t: string) => t);
  return parseLinks(text)
    .map((s) => (s.url ? format.link(s.text, s.url) : plain(s.text)))
    .join("");
}

/** Replace links with their text. */
export function stripLinks(text: string): string {
  return formatLinks(text, { link: (t) => t });
}
