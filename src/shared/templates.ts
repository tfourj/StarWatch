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
  starBody: "{user} starred {repo}. It now has {stars} stars.",
  unstarTitle: "Star removed from {repo}",
  unstarBody: "{user} unstarred {repo}. It now has {stars} stars.",
};
