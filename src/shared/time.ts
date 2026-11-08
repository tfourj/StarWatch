export const TIME_FORMATS = ["auto", "12h", "24h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

/** "relative" shows recent times like "5 minutes ago", "absolute" always shows the date and time. */
export const TIME_STYLES = ["relative", "absolute"] as const;
export type TimeStyle = (typeof TIME_STYLES)[number];

export interface TimePreferences {
  /** IANA timezone, null to use the default (the browser in the app, `TZ` for notifications). */
  timezone: string | null;
  timeFormat: TimeFormat;
  timeStyle: TimeStyle;
}

export const DEFAULT_TIME_PREFERENCES: TimePreferences = { timezone: null, timeFormat: "auto", timeStyle: "relative" };

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** `hourCycle` option for Intl, undefined lets the locale decide. */
export function hourCycleFor(format: TimeFormat): "h12" | "h23" | undefined {
  if (format === "12h") return "h12";
  if (format === "24h") return "h23";
  return undefined;
}
