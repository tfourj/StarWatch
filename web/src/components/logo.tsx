import { cn } from "@/lib/utils";

const STAR = "M32.00 14.10 L36.88 26.89 L50.55 27.57 L39.89 36.16 L43.46 49.38 L32.00 41.90 L20.54 49.38 L24.11 36.16 L13.45 27.57 L27.12 26.89Z";

/** App icon: white star on black in light mode, inverted in dark mode. Same artwork as /favicon.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="64" height="64" rx="14" className="fill-black dark:fill-white" />
      <path
        d={STAR}
        strokeWidth="3"
        strokeLinejoin="round"
        className="fill-white stroke-white dark:fill-black dark:stroke-black"
      />
    </svg>
  );
}
