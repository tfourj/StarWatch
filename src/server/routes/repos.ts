import { and, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthedEnv } from "../auth/middleware";
import { getDb } from "../db/client";
import { channels, REPO_MODES, repositories, repositoryChannels } from "../db/schema";
import { describeHookError } from "../github/hooks";
import { HttpError, parseId, readJson } from "../lib/http";
import { setMonitoringForRepos, syncRepositories, updateRepoMonitoring } from "../services/repos";
import { getGithubClient, getUserSettings, getWebhookUrl } from "../services/settings";
import { listStargazers } from "../services/stargazers";

function ownedRepo(userId: string, id: number) {
  const repo = getDb()
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, id), eq(repositories.userId, userId)))
    .get();
  if (!repo) throw new HttpError(404, "Repository not found");
  return repo;
}

export const repos = new Hono<AuthedEnv>()
  .get("/", (c) => {
    const userId = c.get("user").id;
    const db = getDb();
    const rows = db
      .select()
      .from(repositories)
      .where(and(eq(repositories.userId, userId), isNull(repositories.removedAt)))
      .orderBy(repositories.fullName)
      .all();
    const ids = rows.map((r) => r.id);
    const links = ids.length
      ? db.select().from(repositoryChannels).where(inArray(repositoryChannels.repositoryId, ids)).all()
      : [];
    const userChannels = db
      .select({ id: channels.id, name: channels.name, type: channels.type, allRepos: channels.allRepos, enabled: channels.enabled })
      .from(channels)
      .where(eq(channels.userId, userId))
      .all();
    const settings = getUserSettings(userId);

    return c.json({
      repos: rows.map((r) => ({
        ...r,
        channelIds: links.filter((l) => l.repositoryId === r.id).map((l) => l.channelId),
      })),
      channels: userChannels,
      webhookUrl: getWebhookUrl(),
      hasToken: Boolean(settings.githubToken),
      lastSyncAt: settings.lastSyncAt,
      lastSyncError: settings.lastSyncError,
    });
  })
  .post("/sync", async (c) => {
    const userId = c.get("user").id;
    if (!getUserSettings(userId).githubToken) throw new HttpError(400, "Add a GitHub token in Settings first");
    try {
      return c.json(await syncRepositories(userId));
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : String(err));
    }
  })
  .post("/bulk", async (c) => {
    const body = await readJson<{ monitored?: unknown; repoIds?: unknown }>(c);
    if (typeof body.monitored !== "boolean") throw new HttpError(400, "monitored must be true or false");
    if (body.repoIds !== undefined && !Array.isArray(body.repoIds)) throw new HttpError(400, "repoIds must be an array");
    const repoIds = Array.isArray(body.repoIds) ? body.repoIds.map(Number).filter(Number.isInteger) : undefined;
    return c.json(setMonitoringForRepos(c.get("user").id, body.monitored, repoIds));
  })
  .get("/:id/stargazers", (c) => {
    const result = listStargazers(c.get("user").id, parseId(c.req.param("id")), {
      page: Number(c.req.query("page") ?? 1) || 1,
      pageSize: Number(c.req.query("pageSize") ?? 50) || 50,
      q: c.req.query("q"),
    });
    if (!result) throw new HttpError(404, "Repository not found");
    return c.json(result);
  })
  .patch("/:id", async (c) => {
    const userId = c.get("user").id;
    const id = parseId(c.req.param("id"));
    ownedRepo(userId, id);
    const body = await readJson<{ monitored?: unknown; mode?: unknown }>(c);
    const patch: { monitored?: boolean; mode?: (typeof REPO_MODES)[number] } = {};
    if (body.monitored !== undefined) patch.monitored = Boolean(body.monitored);
    if (body.mode !== undefined) {
      if (!REPO_MODES.includes(body.mode as never)) throw new HttpError(400, "Invalid mode");
      patch.mode = body.mode as (typeof REPO_MODES)[number];
    }
    return c.json(await updateRepoMonitoring(userId, id, patch));
  })
  .put("/:id/channels", async (c) => {
    const userId = c.get("user").id;
    const id = parseId(c.req.param("id"));
    ownedRepo(userId, id);
    const body = await readJson<{ channelIds?: unknown }>(c);
    if (!Array.isArray(body.channelIds)) throw new HttpError(400, "channelIds must be an array");
    const db = getDb();
    const owned = new Set(
      db.select({ id: channels.id }).from(channels).where(eq(channels.userId, userId)).all().map((r) => r.id),
    );
    const wanted = [...new Set(body.channelIds.map(Number))].filter((cid) => owned.has(cid));
    db.transaction((tx) => {
      tx.delete(repositoryChannels).where(eq(repositoryChannels.repositoryId, id)).run();
      if (wanted.length) {
        tx.insert(repositoryChannels).values(wanted.map((channelId) => ({ repositoryId: id, channelId }))).run();
      }
    });
    return c.json({ channelIds: wanted });
  })
  .post("/:id/ping", async (c) => {
    const userId = c.get("user").id;
    const repo = ownedRepo(userId, parseId(c.req.param("id")));
    if (!repo.hookId) throw new HttpError(400, "This repository has no webhook yet. Run a sync first.");
    const client = getGithubClient(userId);
    if (!client) throw new HttpError(400, "No GitHub token configured");
    try {
      await client.pingHook(repo.fullName, repo.hookId);
    } catch (err) {
      throw new HttpError(502, describeHookError(err));
    }
    return c.json({ ok: true });
  });
