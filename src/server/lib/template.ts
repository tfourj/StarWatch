import { DEFAULT_TEMPLATES, type MessageTemplates, type TemplateVars } from "../../shared/templates";

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
  return { title: renderTemplate(title, vars), body: renderTemplate(body, vars) };
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
