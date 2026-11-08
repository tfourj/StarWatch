import { Hono } from "hono";
import { isValidTimeZone, TIME_FORMATS, TIME_STYLES, type TimeFormat, type TimeStyle } from "../../shared/time";
import type { AuthedEnv } from "../auth/middleware";
import { getConfig } from "../config";
import { HttpError, readJson } from "../lib/http";
import { getTimePreferences, getUserSettings, updateUserSettings } from "../services/settings";

function preferencesView(userId: string) {
  return { ...getTimePreferences(userId), serverTimezone: getConfig().timezone };
}

export const me = new Hono<AuthedEnv>()
  .get("/", (c) => c.json({ user: c.get("user") }))
  // The newest version whose release notes the user opened, kept per account so the "What's new" dot clears on
  // every device.
  .get("/seen-version", (c) => c.json({ version: getUserSettings(c.get("user").id).seenVersion }))
  .put("/seen-version", async (c) => {
    const body = await readJson<{ version?: unknown }>(c);
    const version = typeof body.version === "string" ? body.version.trim() : "";
    if (!version || version.length > 64) throw new HttpError(400, "Invalid version");
    updateUserSettings(c.get("user").id, { seenVersion: version });
    return c.json({ version });
  })
  // Timezone and time display, kept per account. A null timezone falls back to the browser in the app and to `TZ`
  // in notifications.
  .get("/preferences", (c) => c.json(preferencesView(c.get("user").id)))
  .put("/preferences", async (c) => {
    const body = await readJson<{ timezone?: unknown; timeFormat?: unknown; timeStyle?: unknown }>(c);
    const patch: Parameters<typeof updateUserSettings>[1] = {};
    if (body.timezone !== undefined) {
      const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
      if (body.timezone !== null && (!timezone || timezone.length > 64 || !isValidTimeZone(timezone))) {
        throw new HttpError(400, "Unknown timezone");
      }
      patch.timezone = timezone || null;
    }
    if (body.timeFormat !== undefined) {
      if (!TIME_FORMATS.includes(body.timeFormat as TimeFormat)) throw new HttpError(400, "Invalid time format");
      patch.timeFormat = body.timeFormat as TimeFormat;
    }
    if (body.timeStyle !== undefined) {
      if (!TIME_STYLES.includes(body.timeStyle as TimeStyle)) throw new HttpError(400, "Invalid time style");
      patch.timeStyle = body.timeStyle as TimeStyle;
    }
    if (Object.keys(patch).length) updateUserSettings(c.get("user").id, patch);
    return c.json(preferencesView(c.get("user").id));
  });
