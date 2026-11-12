import { and, count, desc, eq, gte, inArray, like, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthedEnv } from "../auth/middleware";
import { getDb } from "../db/client";
import { channels, followerDeliveries, followerEvents, followers } from "../db/schema";
import { HttpError, parseId, readJson } from "../lib/http";
import { retryFollowerDelivery } from "../notifications/worker";
import { isImportingFollowers, setFollowerTracking, syncFollowers } from "../services/followers";
import { getUserSettings } from "../services/settings";

function pagination(c: { req: { query: (key: string) => string | undefined } }, fallback: number) {
  const page = Math.max(1, Math.floor(Number(c.req.query("page") ?? 1) || 1));
  const pageSize = Math.min(100, Math.max(5, Math.floor(Number(c.req.query("pageSize") ?? fallback) || fallback)));
  return { page, pageSize };
}

const DAY = 24 * 60 * 60_000;

function statusView(userId: string) {
  const db = getDb();
  const s = getUserSettings(userId);
  const tracked = db.select({ n: count() }).from(followers).where(eq(followers.userId, userId)).get()?.n ?? 0;
  const since = new Date(Date.now() - 30 * DAY);
  const recent = db
    .select({ action: followerEvents.action, n: count() })
    .from(followerEvents)
    .where(and(eq(followerEvents.userId, userId), gte(followerEvents.occurredAt, since)))
    .groupBy(followerEvents.action)
    .all();
  const last30 = (action: string) => recent.find((r) => r.action === action)?.n ?? 0;
  return {
    enabled: s.followersEnabled,
    connected: Boolean(s.githubToken),
    login: s.githubLogin,
    followerCount: s.followerCount,
    tracked,
    followed30d: last30("followed"),
    unfollowed30d: last30("unfollowed"),
    importedAt: s.followersImportedAt,
    checkedAt: s.followersCheckedAt,
    error: s.followersError,
    importing: isImportingFollowers(userId),
    pollingIntervalMinutes: s.pollingIntervalMinutes,
  };
}

function ownedDelivery(userId: string, id: number) {
  const row = getDb()
    .select({ id: followerDeliveries.id, status: followerDeliveries.status })
    .from(followerDeliveries)
    .innerJoin(followerEvents, eq(followerEvents.id, followerDeliveries.eventId))
    .where(and(eq(followerDeliveries.id, id), eq(followerEvents.userId, userId)))
    .get();
  if (!row) throw new HttpError(404, "Delivery not found");
  return row;
}

export const followerRoutes = new Hono<AuthedEnv>()
  .get("/", (c) => c.json(statusView(c.get("user").id)))
  .put("/", async (c) => {
    const userId = c.get("user").id;
    const body = await readJson<{ enabled?: unknown }>(c);
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be true or false");
    if (body.enabled && !getUserSettings(userId).githubToken) {
      throw new HttpError(400, "Add a GitHub token in Settings first");
    }
    setFollowerTracking(userId, body.enabled);
    return c.json(statusView(userId));
  })
  .post("/sync", async (c) => {
    const userId = c.get("user").id;
    const settings = getUserSettings(userId);
    if (!settings.githubToken) throw new HttpError(400, "Add a GitHub token in Settings first");
    if (!settings.followersEnabled) throw new HttpError(400, "Follower tracking is off");
    try {
      return c.json(await syncFollowers(userId));
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : String(err));
    }
  })
  .get("/list", (c) => {
    const userId = c.get("user").id;
    const db = getDb();
    const { page, pageSize } = pagination(c, 50);
    const q = c.req.query("q")?.trim().replace(/[%_]/g, "");
    const where = and(eq(followers.userId, userId), q ? like(followers.login, `%${q}%`) : undefined);

    const total = db.select({ n: count() }).from(followers).where(where).get()?.n ?? 0;
    const items = db
      .select({
        githubUserId: followers.githubUserId,
        login: followers.login,
        avatarUrl: followers.avatarUrl,
        followedAt: followers.followedAt,
      })
      .from(followers)
      .where(where)
      .orderBy(sql`${followers.followedAt} is null`, desc(followers.followedAt), sql`lower(${followers.login})`)
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();
    return c.json({ items, total, page, pageSize });
  })
  .get("/events", (c) => {
    const userId = c.get("user").id;
    const db = getDb();
    const { page, pageSize } = pagination(c, 25);
    const where = eq(followerEvents.userId, userId);

    const total = db.select({ n: count() }).from(followerEvents).where(where).get()?.n ?? 0;
    const rows = db
      .select({
        id: followerEvents.id,
        action: followerEvents.action,
        actorId: followerEvents.actorId,
        actorLogin: followerEvents.actorLogin,
        actorAvatarUrl: followerEvents.actorAvatarUrl,
        actorUrl: followerEvents.actorUrl,
        followerCount: followerEvents.followerCount,
        occurredAt: followerEvents.occurredAt,
      })
      .from(followerEvents)
      .where(where)
      .orderBy(desc(followerEvents.occurredAt), desc(followerEvents.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();

    const ids = rows.map((r) => r.id);
    const deliveries = ids.length
      ? db
          .select({
            id: followerDeliveries.id,
            eventId: followerDeliveries.eventId,
            channelId: followerDeliveries.channelId,
            channelName: channels.name,
            channelType: channels.type,
            status: followerDeliveries.status,
            attempts: followerDeliveries.attempts,
            lastError: followerDeliveries.lastError,
            nextAttemptAt: followerDeliveries.nextAttemptAt,
            deliveredAt: followerDeliveries.deliveredAt,
          })
          .from(followerDeliveries)
          .innerJoin(channels, eq(channels.id, followerDeliveries.channelId))
          .where(inArray(followerDeliveries.eventId, ids))
          .all()
      : [];

    return c.json({
      items: rows.map((r) => ({ ...r, deliveries: deliveries.filter((d) => d.eventId === r.id) })),
      total,
      page,
      pageSize,
    });
  })
  .post("/deliveries/:id/retry", (c) => {
    const id = parseId(c.req.param("id"));
    const delivery = ownedDelivery(c.get("user").id, id);
    if (delivery.status === "success") throw new HttpError(400, "Delivery already succeeded");
    retryFollowerDelivery(id);
    return c.json({ ok: true });
  });
