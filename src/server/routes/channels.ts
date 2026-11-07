import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getChannelType } from "../../shared/channels";
import type { MessageTemplates } from "../../shared/templates";
import type { AuthedEnv } from "../auth/middleware";
import { getDb } from "../db/client";
import { channels, repositories, repositoryChannels, type Channel } from "../db/schema";
import { cipher } from "../lib/crypto";
import { HttpError, parseId, readJson } from "../lib/http";
import { logger } from "../logger";
import { buildMessage, sendToChannel } from "../notifications/worker";
import {
  decryptChannelConfig,
  maskChannelConfig,
  mergeChannelConfig,
  ValidationError,
} from "../services/channels";
import { getUserSettings } from "../services/settings";

const log = logger.child("channels");

interface ChannelBody {
  name?: string;
  type?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  allRepos?: boolean;
  repoIds?: number[];
  notifyStar?: boolean;
  notifyUnstar?: boolean;
  milestoneEvery?: number | null;
  templates?: Partial<MessageTemplates> | null;
}

function serialize(channel: Channel, repoIds: number[]) {
  const masked = maskChannelConfig(channel.type, decryptChannelConfig(channel));
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    enabled: channel.enabled,
    allRepos: channel.allRepos,
    notifyStar: channel.notifyStar,
    notifyUnstar: channel.notifyUnstar,
    milestoneEvery: channel.milestoneEvery,
    templates: channel.templates,
    config: masked.config,
    secrets: masked.secrets,
    repoIds,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

function cleanTemplates(input: ChannelBody["templates"]): Record<string, string> | null {
  if (!input) return null;
  const out: Record<string, string> = {};
  for (const key of ["starTitle", "starBody", "unstarTitle", "unstarBody"] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) out[key] = value.slice(0, 2000);
  }
  return Object.keys(out).length ? out : null;
}

function cleanMilestone(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === 0) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2 || n > 1_000_000) throw new HttpError(400, "Milestone must be a whole number ≥ 2");
  return n;
}

function ownedChannel(userId: string, id: number) {
  const row = getDb()
    .select()
    .from(channels)
    .where(and(eq(channels.id, id), eq(channels.userId, userId)))
    .get();
  if (!row) throw new HttpError(404, "Channel not found");
  return row;
}

function setRepoIds(userId: string, channelId: number, repoIds: number[] | undefined) {
  if (!repoIds) return;
  const db = getDb();
  const owned = new Set(
    db.select({ id: repositories.id }).from(repositories).where(eq(repositories.userId, userId)).all().map((r) => r.id),
  );
  const wanted = [...new Set(repoIds.map(Number))].filter((id) => owned.has(id));
  db.transaction((tx) => {
    tx.delete(repositoryChannels).where(eq(repositoryChannels.channelId, channelId)).run();
    if (wanted.length) {
      tx.insert(repositoryChannels).values(wanted.map((repositoryId) => ({ repositoryId, channelId }))).run();
    }
  });
}

function repoIdsFor(channelId: number) {
  return getDb()
    .select({ id: repositoryChannels.repositoryId })
    .from(repositoryChannels)
    .where(eq(repositoryChannels.channelId, channelId))
    .all()
    .map((r) => r.id);
}

function wrapValidation<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ValidationError) throw new HttpError(400, err.message);
    throw err;
  }
}

export const channelRoutes = new Hono<AuthedEnv>()
  .get("/", (c) => {
    const rows = getDb().select().from(channels).where(eq(channels.userId, c.get("user").id)).orderBy(channels.name).all();
    return c.json({ channels: rows.map((ch) => serialize(ch, repoIdsFor(ch.id))) });
  })
  .post("/", async (c) => {
    const userId = c.get("user").id;
    const body = await readJson<ChannelBody>(c);
    const name = body.name?.trim();
    if (!name) throw new HttpError(400, "Name is required");
    if (!body.type || !getChannelType(body.type)) throw new HttpError(400, "Unknown channel type");
    const config = wrapValidation(() => mergeChannelConfig(body.type!, null, body.config ?? {}));

    const created = getDb()
      .insert(channels)
      .values({
        userId,
        name,
        type: body.type,
        config: cipher().encryptJson(config),
        enabled: body.enabled ?? true,
        allRepos: body.allRepos ?? true,
        notifyStar: body.notifyStar ?? true,
        notifyUnstar: body.notifyUnstar ?? true,
        milestoneEvery: cleanMilestone(body.milestoneEvery),
        templates: cleanTemplates(body.templates),
      })
      .returning()
      .get();
    setRepoIds(userId, created.id, body.repoIds);
    log.info("channel created", { id: created.id, type: created.type });
    return c.json(serialize(created, repoIdsFor(created.id)), 201);
  })
  .patch("/:id", async (c) => {
    const userId = c.get("user").id;
    const existing = ownedChannel(userId, parseId(c.req.param("id")));
    const body = await readJson<ChannelBody>(c);

    const patch: Partial<Channel> = {};
    if (body.name !== undefined) {
      if (!body.name.trim()) throw new HttpError(400, "Name is required");
      patch.name = body.name.trim();
    }
    if (body.config !== undefined) {
      const merged = wrapValidation(() => mergeChannelConfig(existing.type, decryptChannelConfig(existing), body.config!));
      patch.config = cipher().encryptJson(merged);
    }
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.allRepos !== undefined) patch.allRepos = Boolean(body.allRepos);
    if (body.notifyStar !== undefined) patch.notifyStar = Boolean(body.notifyStar);
    if (body.notifyUnstar !== undefined) patch.notifyUnstar = Boolean(body.notifyUnstar);
    if (body.milestoneEvery !== undefined) patch.milestoneEvery = cleanMilestone(body.milestoneEvery);
    if (body.templates !== undefined) patch.templates = cleanTemplates(body.templates);

    if (Object.keys(patch).length) getDb().update(channels).set(patch).where(eq(channels.id, existing.id)).run();
    setRepoIds(userId, existing.id, body.repoIds);
    return c.json(serialize(ownedChannel(userId, existing.id), repoIdsFor(existing.id)));
  })
  .delete("/:id", (c) => {
    const channel = ownedChannel(c.get("user").id, parseId(c.req.param("id")));
    getDb().delete(channels).where(eq(channels.id, channel.id)).run();
    log.info("channel deleted", { id: channel.id });
    return c.json({ ok: true });
  })
  .post("/:id/test", async (c) => {
    const user = c.get("user");
    const channel = ownedChannel(user.id, parseId(c.req.param("id")));
    const settings = getUserSettings(user.id);
    const repo =
      getDb()
        .select()
        .from(repositories)
        .where(and(eq(repositories.userId, user.id), eq(repositories.monitored, true)))
        .limit(1)
        .get() ?? null;

    const login = settings.githubLogin ?? "octocat";
    const message = buildMessage(
      channel,
      {
        action: "created",
        actorLogin: login,
        actorUrl: `https://github.com/${login}`,
        actorAvatarUrl: `https://github.com/${login}.png`,
        starCount: (repo?.starCount ?? 41) + 1,
        occurredAt: new Date(),
      },
      repo ?? { fullName: "octocat/hello-world", htmlUrl: "https://github.com/octocat/hello-world" },
      true,
    );

    try {
      await sendToChannel(channel, message);
      log.info("test notification sent", { id: channel.id, type: channel.type });
      return c.json({ ok: true });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("test notification failed", { id: channel.id, type: channel.type, error });
      throw new HttpError(502, error);
    }
  });
