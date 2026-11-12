// Captures README screenshots of a seeded StarWatch instance with headless Chrome.
// Runs inside the zenika/alpine-chrome:with-puppeteer container started by scripts/screenshots.sh.
const puppeteer = require("puppeteer");
const BASE = "http://localhost:4321";
const THEME = process.env.THEME || "dark";
const SHOTS = [
  { name: "dashboard", path: "/" },
  { name: "repositories", path: "/repositories" },
  { name: "followers", path: "/followers" },
  { name: "events", path: "/events" },
  { name: "channels", path: "/channels" },
];

(async () => {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: "alex@example.com", password: "demopass123" }),
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
  const cookies = raw.filter(Boolean).map((c) => {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: "localhost", path: "/" };
  });
  if (!res.ok || cookies.length === 0) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: THEME }]);
  // Mark the current version's release notes as seen on the account so the "new" dot does not show.
  const { version } = await (await fetch(`${BASE}/api/setup/status`)).json();
  const seen = await fetch(`${BASE}/api/me/seen-version`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: BASE,
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    },
    body: JSON.stringify({ version }),
  });
  if (!seen.ok) throw new Error(`marking the version seen failed: ${seen.status} ${await seen.text()}`);
  await page.evaluateOnNewDocument((theme) => localStorage.setItem("starwatch-theme", theme), THEME);
  await page.setCookie(...cookies);

  for (const s of SHOTS) {
    await page.goto(BASE + s.path, { waitUntil: "networkidle0" });
    // The container's fontconfig falls back to the emoji font for digits and spaces; pin Inter.
    await page.addStyleTag({ content: "body, body *:not(code) { font-family: Inter, sans-serif !important; }" });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: `/out/${s.name}.png` });
    console.log("saved", s.name);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
