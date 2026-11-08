import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DEFAULT_TIME_PREFERENCES, hourCycleFor, type TimePreferences } from "@shared/time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat().format(n);
}

let timePreferences: TimePreferences = DEFAULT_TIME_PREFERENCES;

/** Set the signed-in user's timezone and time display, used by every formatter below. */
export function setTimePreferences(prefs: TimePreferences) {
  timePreferences = prefs;
}

/** Timezone and hour cycle options from the user's preferences, merged into `options`. */
export function withTimePreferences(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  const { timezone, timeFormat } = timePreferences;
  return { ...options, timeZone: timezone ?? undefined, hourCycle: hourCycleFor(timeFormat) };
}

export function formatDateTime(value: string | number | Date | null | undefined) {
  if (!value) return "Never";
  const options = withTimePreferences({ dateStyle: "medium", timeStyle: "short" });
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

/** "5 minutes ago", or the full date and time when the user prefers absolute times. */
export function timeAgo(value: string | number | Date | null | undefined) {
  if (!value) return "never";
  if (timePreferences.timeStyle === "absolute") return formatDateTime(value);
  const diff = Date.now() - new Date(value).getTime();
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(diff);
  const sign = diff > 0 ? -1 : 1;
  if (abs < 60_000) return rtf.format(sign * Math.round(abs / 1000), "second");
  if (abs < 3_600_000) return rtf.format(sign * Math.round(abs / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(sign * Math.round(abs / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(sign * Math.round(abs / 86_400_000), "day");
  return formatDateTime(value);
}
