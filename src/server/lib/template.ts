import { DEFAULT_TEMPLATES, renderTemplate, stripLinks } from "../../shared/templates";
import type { MessageTemplates, TemplateVars } from "../../shared/templates";

export { renderTemplate };

export function mergeTemplates(...layers: (Partial<MessageTemplates> | null | undefined)[]): MessageTemplates {
  const result: MessageTemplates = { ...DEFAULT_TEMPLATES };
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of Object.keys(result) as (keyof MessageTemplates)[]) {
      const value = layer[key];
      if (typeof value === "string" && value.trim() !== "") result[key] = value;
    }
  }
  return result;
}

export function renderMessage(action: "created" | "deleted", templates: MessageTemplates, vars: TemplateVars) {
  const title = action === "created" ? templates.starTitle : templates.unstarTitle;
  const body = action === "created" ? templates.starBody : templates.unstarBody;
  return { title: stripLinks(renderTemplate(title, vars)), body: renderTemplate(body, vars) };
}

/**
 * "7 Nov 2026, 19:00 UTC" in the given timezone. Built from parts because dateStyle cannot be combined with
 * timeZoneName, and engines disagree on the separator between date and time.
 */
export function formatEventTime(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
      timeZoneName: "short",
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    const day = `${get("day")} ${get("month")} ${get("year")}`;
    return `${day}, ${get("hour")}:${get("minute")} ${get("timeZoneName")}`.trim();
  } catch {
    return date.toISOString();
  }
}
