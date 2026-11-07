import { and, count, desc, eq, like, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { repositories, stargazers } from "../db/schema";

export interface StargazerListOptions {
  page?: number;
  pageSize?: number;
  q?: string;
}

/** Tracked stargazers of one repo, newest first. Returns null when the repo does not belong to the user. */
export function listStargazers(userId: string, repoId: number, options: StargazerListOptions = {}) {
  const db = getDb();
  const repo = db
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, userId)))
    .get();
  if (!repo) return null;

  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 50)));
  const q = options.q?.trim().replace(/[%_]/g, "");
  const where = and(
    eq(stargazers.repositoryId, repoId),
    q ? like(stargazers.login, `%${q}%`) : undefined,
  );

  const total = db.select({ n: count() }).from(stargazers).where(where).get()?.n ?? 0;
  const items = db
    .select({
      githubUserId: stargazers.githubUserId,
      login: stargazers.login,
      avatarUrl: stargazers.avatarUrl,
      starredAt: stargazers.starredAt,
    })
    .from(stargazers)
    .where(where)
    .orderBy(sql`${stargazers.starredAt} is null`, desc(stargazers.starredAt), stargazers.login)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return {
    items,
    total,
    page,
    pageSize,
    repo: {
      id: repo.id,
      fullName: repo.fullName,
      htmlUrl: repo.htmlUrl,
      starCount: repo.starCount,
      backfilledAt: repo.backfilledAt,
      backfillError: repo.backfillError,
    },
  };
}
