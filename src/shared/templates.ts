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
  bold?: boolean;
}

const LINK_PATTERN = /\[([^[\]\n]+)\]\((https?:\/\/[^\s()]+)\)/g;
/** **text** on one line, with no space just inside the markers. */
const BOLD_PATTERN = /\*\*(?=\S)([^\n]*?\S)\*\*/g;
const WHOLE_BOLD = /^\*\*(?=\S)([^\n]*\S)\*\*$/;
const LINK_SLOT = /\u0000(\d+)\u0000/;

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

/**
 * Split rendered text into parts with their link and bold flags. **text** is bold and may wrap links, as in
 * **[{user}]({user_url})**. A link is also bold when its whole text is, as in [**{user}**]({user_url}).
 */
export function parseMarkup(text: string): TemplateSegment[] {
  const links: TemplateSegment[] = [];
  // Hide links first so markers inside a link cannot start or end a bold run.
  const masked = text.replace(LINK_PATTERN, (_match, label: string, url: string) => {
    const inner = WHOLE_BOLD.exec(label)?.[1];
    links.push(inner ? { text: inner, url, bold: true } : { text: label, url });
    return `\u0000${links.length - 1}\u0000`;
  });

  const segments: TemplateSegment[] = [];
  const addRun = (run: string, bold: boolean) => {
    run.split(LINK_SLOT).forEach((part, i) => {
      if (i % 2 === 1) {
        const link = links[Number(part)]!;
        segments.push(bold ? { ...link, bold } : link);
      } else if (part) {
        segments.push(bold ? { text: part, bold } : { text: part });
      }
    });
  };
  let last = 0;
  for (const match of masked.matchAll(BOLD_PATTERN)) {
    addRun(masked.slice(last, match.index), false);
    addRun(match[1]!, true);
    last = match.index + match[0].length;
  }
  addRun(masked.slice(last), false);
  return segments;
}

export interface MarkupFormat {
  text?: (text: string) => string;
  link: (text: string, url: string) => string;
  /** Wraps a run of bold parts that are already formatted. Leave out to drop the markers. */
  bold?: (inner: string) => string;
}

/** Rebuild text with each part formatted, for example as HTML or Slack mrkdwn. */
export function formatMarkup(text: string, format: MarkupFormat): string {
  const plain = format.text ?? ((t: string) => t);
  const bold = format.bold ?? ((t: string) => t);
  let out = "";
  let run = "";
  let inBold = false;
  for (const s of parseMarkup(text)) {
    if (Boolean(s.bold) !== inBold) {
      out += inBold ? bold(run) : run;
      run = "";
      inBold = !inBold;
    }
    run += s.url ? format.link(s.text, s.url) : plain(s.text);
  }
  return out + (inBold ? bold(run) : run);
}

/** Replace links with their text and drop bold markers. */
export function stripMarkup(text: string): string {
  return formatMarkup(text, { link: (t) => t });
}
