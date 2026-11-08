import { Hono } from "hono";
import type { AuthedEnv } from "../auth/middleware";
import { HttpError, readJson } from "../lib/http";
import { getUserSettings, updateUserSettings } from "../services/settings";

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
  });
