const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Version\/[\d.]+.*Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

const match = (ua: string, list: [RegExp, string][]) => list.find(([re]) => re.test(ua))?.[1] ?? null;

/** A short, human label for a User-Agent, for example "Chrome on macOS". */
export function describeUserAgent(ua: string | null | undefined): string {
  const value = ua?.trim();
  if (!value) return "Unknown device";
  const browser = match(value, BROWSERS);
  const system = match(value, SYSTEMS);
  if (browser && system) return `${browser} on ${system}`;
  if (browser || system) return (browser ?? system)!;
  // Scripts and CLI tools: keep the first product token, for example "curl/8.7.1".
  return value.split(/\s+/)[0]!.slice(0, 60);
}
