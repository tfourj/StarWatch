import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat().format(n);
}

export function formatDateTime(value: string | number | Date | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function timeAgo(value: string | number | Date | null | undefined) {
  if (!value) return "never";
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
