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

export function formatEventTime(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
