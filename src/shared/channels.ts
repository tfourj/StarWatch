export type FieldType = "text" | "password" | "url" | "number" | "select" | "textarea" | "boolean" | "email";

export interface ChannelField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Stored encrypted and never returned to the browser. */
  secret?: boolean;
  placeholder?: string;
  help?: string;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
}

export interface ChannelTypeInfo {
  type: string;
  name: string;
  description: string;
  fields: ChannelField[];
}

const priority = (values: [string, string][]) => values.map(([value, label]) => ({ value, label }));

export const CHANNEL_TYPES: ChannelTypeInfo[] = [
  {
    type: "discord",
    name: "Discord",
    description: "Post an embed through a Discord channel webhook.",
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        type: "url",
        required: true,
        secret: true,
        placeholder: "https://discord.com/api/webhooks/...",
      },
      { key: "username", label: "Bot name", type: "text", placeholder: "StarWatch" },
    ],
  },
  {
    type: "telegram",
    name: "Telegram",
    description: "Send a message with a Telegram bot.",
    fields: [
      { key: "botToken", label: "Bot token", type: "password", required: true, secret: true, placeholder: "123456:ABC..." },
      { key: "chatId", label: "Chat ID", type: "text", required: true, placeholder: "-1001234567890" },
      { key: "threadId", label: "Topic ID", type: "text", help: "Optional forum topic id" },
    ],
  },
  {
    type: "ntfy",
    name: "ntfy",
    description: "Publish to an ntfy topic (ntfy.sh or self-hosted).",
    fields: [
      { key: "serverUrl", label: "Server URL", type: "url", required: true, default: "https://ntfy.sh" },
      { key: "topic", label: "Topic", type: "text", required: true },
      { key: "token", label: "Access token", type: "password", secret: true, help: "Optional, for protected topics" },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        default: "3",
        options: priority([["1", "Min"], ["2", "Low"], ["3", "Default"], ["4", "High"], ["5", "Max"]]),
      },
    ],
  },
  {
    type: "gotify",
    name: "Gotify",
    description: "Push a message to a Gotify server.",
    fields: [
      { key: "serverUrl", label: "Server URL", type: "url", required: true, placeholder: "https://gotify.example.com" },
      { key: "appToken", label: "App token", type: "password", required: true, secret: true },
      { key: "priority", label: "Priority", type: "number", default: 5 },
    ],
  },
  {
    type: "slack",
    name: "Slack",
    description: "Post through a Slack incoming webhook.",
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        type: "url",
        required: true,
        secret: true,
        placeholder: "https://hooks.slack.com/services/...",
      },
    ],
  },
  {
    type: "pushover",
    name: "Pushover",
    description: "Send a Pushover notification.",
    fields: [
      { key: "userKey", label: "User key", type: "password", required: true, secret: true },
      { key: "apiToken", label: "API token", type: "password", required: true, secret: true },
      { key: "device", label: "Device", type: "text", help: "Optional, all devices when empty" },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        default: "0",
        options: priority([["-2", "Lowest"], ["-1", "Low"], ["0", "Normal"], ["1", "High"]]),
      },
      { key: "sound", label: "Sound", type: "text", help: "Optional Pushover sound name" },
    ],
  },
  {
    type: "email",
    name: "Email (SMTP)",
    description: "Send an email through any SMTP server.",
    fields: [
      { key: "host", label: "SMTP host", type: "text", required: true, placeholder: "smtp.example.com" },
      { key: "port", label: "Port", type: "number", required: true, default: 587 },
      { key: "secure", label: "Use TLS on connect (port 465)", type: "boolean", default: false },
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password", secret: true },
      { key: "from", label: "From", type: "email", required: true, placeholder: "starwatch@example.com" },
      { key: "to", label: "To", type: "text", required: true, help: "Comma separated addresses" },
    ],
  },
  {
    type: "webhook",
    name: "Webhook (JSON)",
    description: "POST a JSON payload to any URL.",
    fields: [
      { key: "url", label: "URL", type: "url", required: true, secret: true },
      {
        key: "method",
        label: "Method",
        type: "select",
        default: "POST",
        options: priority([["POST", "POST"], ["PUT", "PUT"]]),
      },
      {
        key: "headers",
        label: "Headers (JSON)",
        type: "textarea",
        secret: true,
        placeholder: '{"Authorization": "Bearer ..."}',
      },
    ],
  },
];

export function getChannelType(type: string): ChannelTypeInfo | undefined {
  return CHANNEL_TYPES.find((t) => t.type === type);
}
