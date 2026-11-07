import { and, count, desc, eq, inArray, like, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthedEnv } from "../auth/middleware";
import { getDb } from "../db/client";
import {
  channels,
  DELIVERY_STATUSES,
  deliveryAttempts,
  notificationDeliveries,
  repositories,
  starEvents,
} from "../db/schema";
import { HttpError, parseId } from "../lib/http";
import { retryDelivery } from "../notifications/worker";

function ownedDelivery(userId: string, id: number) {
  const row = getDb()
    .select({ id: notificationDeliveries.id, status: notificationDeliveries.status })
    .from(notificationDeliveries)
    .innerJoin(starEvents, eq(starEvents.id, notificationDeliveries.eventId))
    .where(and(eq(notificationDeliveries.id, id), eq(starEvents.userId, userId)))
    .get();
  if (!row) throw new HttpError(404, "Delivery not found");
  return row;
}

export const events = new Hono<AuthedEnv>()
  .get("/", (c) => {
    const userId = c.get("user").id;
    const db = getDb();
    const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(c.req.query("pageSize") ?? 25) || 25));
    const repoId = c.req.query("repoId");
    const action = c.req.query("action");
    const status = c.req.query("status");
    const source = c.req.query("source");
    const q = c.req.query("q")?.trim();

    const filters: SQL[] = [eq(starEvents.userId, userId)];
    if (repoId) filters.push(eq(starEvents.repositoryId, parseId(repoId)));
    if (action === "created" || action === "deleted") filters.push(eq(starEvents.action, action));
    if (source === "webhook" || source === "polling") filters.push(eq(starEvents.source, source));
    if (q) filters.push(like(starEvents.actorLogin, `%${q.replace(/[%_]/g, "")}%`));
    if (status && DELIVERY_STATUSES.includes(status as never)) {
      filters.push(
        sql`exists (select 1 from ${notificationDeliveries} where ${notificationDeliveries.eventId} = ${starEvents.id} and ${notificationDeliveries.status} = ${status})`,
      );
    }
    if (status === "none") {
      filters.push(
        sql`not exists (select 1 from ${notificationDeliveries} where ${notificationDeliveries.eventId} = ${starEvents.id})`,
      );
    }
    const where = and(...filters);

    const total = db.select({ n: count() }).from(starEvents).where(where).get()?.n ?? 0;
    const rows = db
      .select({
        id: starEvents.id,
        action: starEvents.action,
        actorId: starEvents.actorId,
        actorLogin: starEvents.actorLogin,
        actorAvatarUrl: starEvents.actorAvatarUrl,
        actorUrl: starEvents.actorUrl,
        starCount: starEvents.starCount,
        source: starEvents.source,
        occurredAt: starEvents.occurredAt,
        repositoryId: starEvents.repositoryId,
        repoFullName: repositories.fullName,
        repoUrl: repositories.htmlUrl,
      })
      .from(starEvents)
      .innerJoin(repositories, eq(repositories.id, starEvents.repositoryId))
      .where(where)
      .orderBy(desc(starEvents.occurredAt), desc(starEvents.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();

    const ids = rows.map((r) => r.id);
    const deliveries = ids.length
      ? db
          .select({
            id: notificationDeliveries.id,
            eventId: notificationDeliveries.eventId,
            channelId: notificationDeliveries.channelId,
            channelName: channels.name,
            channelType: channels.type,
            status: notificationDeliveries.status,
            attempts: notificationDeliveries.attempts,
            lastError: notificationDeliveries.lastError,
            nextAttemptAt: notificationDeliveries.nextAttemptAt,
            deliveredAt: notificationDeliveries.deliveredAt,
          })
          .from(notificationDeliveries)
          .innerJoin(channels, eq(channels.id, notificationDeliveries.channelId))
          .where(inArray(notificationDeliveries.eventId, ids))
          .all()
      : [];

    return c.json({
      items: rows.map((r) => ({ ...r, deliveries: deliveries.filter((d) => d.eventId === r.id) })),
      total,
      page,
      pageSize,
    });
  })
  .get("/deliveries/:id/attempts", (c) => {
    const id = parseId(c.req.param("id"));
    ownedDelivery(c.get("user").id, id);
    const attempts = getDb()
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, id))
      .orderBy(deliveryAttempts.attempt)
      .all();
    return c.json({ attempts });
  })
  .post("/deliveries/:id/retry", (c) => {
    const id = parseId(c.req.param("id"));
    const delivery = ownedDelivery(c.get("user").id, id);
    if (delivery.status === "success") throw new HttpError(400, "Delivery already succeeded");
    retryDelivery(id);
    return c.json({ ok: true });
  });
