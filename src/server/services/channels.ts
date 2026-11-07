import { getChannelType, type ChannelField } from "../../shared/channels";
import type { Channel } from "../db/schema";
import { cipher, hint } from "../lib/crypto";
import type { ChannelConfig } from "../notifications/types";

export class ValidationError extends Error {}

export function decryptChannelConfig(channel: Pick<Channel, "config">): ChannelConfig {
  return cipher().decryptJson<ChannelConfig>(channel.config);
}

function coerce(field: ChannelField, value: unknown): string | number | boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (field.type === "boolean") return value === true || value === "true";
  if (field.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new ValidationError(`${field.label} must be a number`);
    return n;
  }
  return String(value).trim();
}

/**
 * Merge an update from the browser into the stored config.
 * Secret fields left empty keep their stored value, so secrets never need to round-trip.
 */
export function mergeChannelConfig(type: string, stored: ChannelConfig | null, incoming: Record<string, unknown>) {
  const info = getChannelType(type);
  if (!info) throw new ValidationError(`Unknown channel type: ${type}`);

  const result: ChannelConfig = {};
  for (const field of info.fields) {
    let value = coerce(field, incoming[field.key]);
    if (value === undefined && field.secret && stored) value = stored[field.key];
    if (value === undefined && field.default !== undefined) value = field.default;
    if (field.required && (value === undefined || value === "")) throw new ValidationError(`${field.label} is required`);
    if (value !== undefined && field.type === "url") {
      try {
        const url = new URL(String(value));
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch {
        throw new ValidationError(`${field.label} must be an http(s) URL`);
      }
    }
    if (value !== undefined && field.key === "headers") {
      try {
        const parsed = JSON.parse(String(value));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      } catch {
        throw new ValidationError("Headers must be a JSON object");
      }
    }
    if (value !== undefined) result[field.key] = value;
  }
  return result;
}

/** Public view of a config: secret values removed, with a short hint so the UI can show they are set. */
export function maskChannelConfig(type: string, config: ChannelConfig) {
  const info = getChannelType(type);
  const publicConfig: ChannelConfig = {};
  const secrets: Record<string, string | null> = {};
  for (const field of info?.fields ?? []) {
    const value = config[field.key];
    if (field.secret) secrets[field.key] = value === undefined || value === "" ? null : hint(String(value));
    else if (value !== undefined) publicConfig[field.key] = value;
  }
  return { config: publicConfig, secrets };
}
