import { and, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthedEnv } from "../auth/middleware";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import { notificationDeliveries, repositories, stargazers, starEvents } from "../db/schema";
import { getRateLimit } from "../github/client";
import { dayKey, startOfDay } from "../lib/time";
import { getUserSettings } from "../services/settings";

const DAY = 24 * 60 * 60_000;

export const dashboard = new Hono<AuthedEnv>().get("/", (c) => {
  const userId = c.get("user").id;
  const db = getDb();
  const tz = getConfig().timezone;
  const now = new Date();
  const todayStart = startOfDay(now, tz);
  const chartStart = new Date(todayStart.getTime() - 29 * DAY);

  const repos = db
    .select()
    .from(repositories)
    .where(and(eq(repositories.userId, userId), isNull(repositories.removedAt)))
    .all();
  const monitoredIds = repos.filter((r) => r.monitored).map((r) => r.id);

  const starsSince = (since: Date) =>
    monitoredIds.length === 0
      ? 0
      : (db
          .select({ n: count() })
          .from(stargazers)
          .where(and(inArray(stargazers.repositoryId, monitoredIds), gte(stargazers.starredAt, since)))
          .get()?.n ?? 0);

  const recentStars =
    monitoredIds.length === 0
      ? []
      : db
          .select({ starredAt: stargazers.starredAt })
          .from(stargazers)
          .where(and(inArray(stargazers.repositoryId, monitoredIds), gte(stargazers.starredAt, chartStart)))
          .all();
  const recentUnstars = db
    .select({ occurredAt: starEvents.occurredAt })
    .from(starEvents)
    .where(and(eq(starEvents.userId, userId), eq(starEvents.action, "deleted"), gte(starEvents.occurredAt, chartStart)))
    .all();

  const buckets = new Map<string, { date: string; stars: number; unstars: number }>();
  for (let i = 0; i < 30; i++) {
    const key = dayKey(new Date(chartStart.getTime() + i * DAY + 12 * 60 * 60_000), tz);
    buckets.set(key, { date: key, stars: 0, unstars: 0 });
  }
  for (const s of recentStars) if (s.starredAt) {
    const b = buckets.get(dayKey(s.starredAt, tz));
    if (b) b.stars++;
  }
  for (const e of recentUnstars) {
    const b = buckets.get(dayKey(e.occurredAt, tz));
    if (b) b.unstars++;
  }

  const recentEvents = db
    .select({
      id: starEvents.id,
      action: starEvents.action,
      actorLogin: starEvents.actorLogin,
      actorAvatarUrl: starEvents.actorAvatarUrl,
      actorUrl: starEvents.actorUrl,
      starCount: starEvents.starCount,
      source: starEvents.source,
      occurredAt: starEvents.occurredAt,
      repoFullName: repositories.fullName,
      repoUrl: repositories.htmlUrl,
    })
    .from(starEvents)
    .innerJoin(repositories, eq(repositories.id, starEvents.repositoryId))
    .where(eq(starEvents.userId, userId))
    .orderBy(desc(starEvents.occurredAt))
    .limit(10)
    .all();

  const failedDeliveries =
    db
      .select({ n: count() })
      .from(notificationDeliveries)
      .innerJoin(starEvents, eq(starEvents.id, notificationDeliveries.eventId))
      .where(
        and(
          eq(starEvents.userId, userId),
          eq(notificationDeliveries.status, "failed"),
          gte(notificationDeliveries.createdAt, new Date(now.getTime() - 7 * DAY)),
        ),
      )
      .get()?.n ?? 0;

  const settings = getUserSettings(userId);
  const topRepos = [...repos].sort((a, b) => b.starCount - a.starCount).slice(0, 5);

  return c.json({
    stats: {
      totalStars: repos.reduce((sum, r) => sum + r.starCount, 0),
      repositories: repos.length,
      monitored: monitoredIds.length,
      starsToday: starsSince(todayStart),
      stars7d: starsSince(new Date(todayStart.getTime() - 6 * DAY)),
      stars30d: starsSince(chartStart),
      hookErrors: repos.filter((r) => r.monitored && r.hookStatus === "error").length,
      failedDeliveries,
    },
    chart: [...buckets.values()],
    recentEvents,
    topRepos: topRepos.map((r) => ({ id: r.id, fullName: r.fullName, htmlUrl: r.htmlUrl, starCount: r.starCount })),
    github: {
      connected: Boolean(settings.githubToken),
      login: settings.githubLogin,
      lastSyncAt: settings.lastSyncAt,
      lastSyncError: settings.lastSyncError,
      rateLimit: getRateLimit(userId),
    },
    timezone: tz,
  });
});
