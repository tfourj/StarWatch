import { DeliveryError } from "./types";

const TIMEOUT_MS = 15_000;

export async function sendHttp(
  url: string,
  init: { method?: string; headers?: Record<string, string>; json?: unknown; form?: URLSearchParams },
) {
  const headers: Record<string, string> = { "User-Agent": "StarWatch", ...init.headers };
  let body: string | URLSearchParams | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    body = init.form;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "POST",
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new DeliveryError(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new DeliveryError(`HTTP ${res.status}${text ? `: ${text}` : ""}`, res.status);
  }
  return res;
}

export function requireString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim() === "") throw new DeliveryError(`Missing ${key}`);
  return value.trim();
}

export function optionalString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str === "" ? undefined : str;
}

export function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}
