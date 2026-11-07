import { logger } from "../logger";

const log = logger.child("github");
const API = "https://api.github.com";
const USER_AGENT = "StarWatch";

export interface RateLimitState {
  limit: number;
  remaining: number;
  resetAt: number;
  /** Requests are refused locally until this time. */
  blockedUntil: number;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

export class GitHubRateLimitError extends GitHubError {
  constructor(public resetAt: number) {
    super(`GitHub rate limit reached, resets at ${new Date(resetAt).toISOString()}`, 429);
  }
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  html_url: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
}

export interface GitHubUserSummary {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
}

export interface GitHubStargazer {
  starred_at: string | null;
  user: GitHubUserSummary;
}

export interface GitHubHook {
  id: number;
  name: string;
  active: boolean;
  events: string[];
  config: { url?: string; content_type?: string; insecure_ssl?: string; secret?: string };
  last_response?: { code: number | null; status: string | null; message: string | null };
}

export interface GitHubHookDelivery {
  id: number;
  guid: string;
  delivered_at: string;
  redelivery: boolean;
  duration: number;
  status: string;
  status_code: number;
  event: string;
  action: string | null;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  accept?: string;
}

const rateLimits = new Map<string, RateLimitState>();

/** Keep this many requests in reserve for user-triggered actions. */
const RESERVE = 50;

export function getRateLimit(key: string): RateLimitState | null {
  return rateLimits.get(key) ?? null;
}

export class GitHubClient {
  constructor(
    private token: string,
    /** Key for the shared rate-limit state, usually the StarWatch user id. */
    private key: string = token.slice(-8),
    private fetchImpl: typeof fetch = fetch,
  ) {}

  get rateLimit(): RateLimitState | null {
    return getRateLimit(this.key);
  }

  /** True when background work should pause to keep a reserve. */
  shouldBackOff(cost = 1): boolean {
    const state = this.rateLimit;
    if (!state) return false;
    if (state.blockedUntil > Date.now()) return true;
    if (state.resetAt < Date.now()) return false;
    return state.remaining - cost < RESERVE;
  }

  private updateRateLimit(headers: Headers, status: number) {
    const limit = Number(headers.get("x-ratelimit-limit"));
    const remaining = Number(headers.get("x-ratelimit-remaining"));
    const reset = Number(headers.get("x-ratelimit-reset"));
    const prev = rateLimits.get(this.key);
    const state: RateLimitState = {
      limit: Number.isFinite(limit) && headers.has("x-ratelimit-limit") ? limit : (prev?.limit ?? 5000),
      remaining: Number.isFinite(remaining) && headers.has("x-ratelimit-remaining") ? remaining : (prev?.remaining ?? 5000),
      resetAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : (prev?.resetAt ?? 0),
      blockedUntil: prev?.blockedUntil ?? 0,
    };

    const retryAfter = Number(headers.get("retry-after"));
    if ((status === 403 || status === 429) && (state.remaining === 0 || retryAfter > 0)) {
      const until = retryAfter > 0 ? Date.now() + retryAfter * 1000 : state.resetAt || Date.now() + 60_000;
      state.blockedUntil = Math.max(until, Date.now() + 1000);
      log.warn("rate limited, backing off", { key: this.key, until: new Date(state.blockedUntil).toISOString() });
    }
    rateLimits.set(this.key, state);
    return state;
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}) {
    const state = this.rateLimit;
    if (state && state.blockedUntil > Date.now()) throw new GitHubRateLimitError(state.blockedUntil);

    const url = new URL(path.startsWith("http") ? path : API + path);
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: options.accept ?? "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });

    const rate = this.updateRateLimit(res.headers, res.status);
    const text = await res.text();
    const data = text ? safeJson(text) : null;

    if (!res.ok) {
      if (rate.blockedUntil > Date.now()) throw new GitHubRateLimitError(rate.blockedUntil);
      const message = (data as { message?: string } | null)?.message ?? res.statusText;
      throw new GitHubError(`GitHub ${method} ${url.pathname} failed: ${res.status} ${message}`, res.status, data);
    }
    return { data: data as T, headers: res.headers, status: res.status };
  }

  async paginate<T>(path: string, options: RequestOptions = {}): Promise<T[]> {
    const results: T[] = [];
    let next: string | null = path;
    let first = true;
    while (next) {
      const page: { data: T[]; headers: Headers } = await this.request<T[]>("GET", next, {
        ...options,
        query: first ? { per_page: 100, ...options.query } : undefined,
      });
      results.push(...page.data);
      next = parseNextLink(page.headers.get("link"));
      first = false;
    }
    return results;
  }

  async getAuthenticatedUser() {
    const res = await this.request<GitHubUserSummary & { name: string | null }>("GET", "/user");
    const header = res.headers.get("x-oauth-scopes");
    const scopes = header === null ? null : header.split(",").map((s) => s.trim()).filter(Boolean);
    return { user: res.data, scopes };
  }

  listOwnedRepos() {
    return this.paginate<GitHubRepo>("/user/repos", { query: { affiliation: "owner", sort: "full_name" } });
  }

  async getRepo(fullName: string) {
    return (await this.request<GitHubRepo>("GET", `/repos/${fullName}`)).data;
  }

  async listStargazersPage(fullName: string, page: number, perPage = 100) {
    const res = await this.request<GitHubStargazer[]>("GET", `/repos/${fullName}/stargazers`, {
      query: { per_page: perPage, page },
      accept: "application/vnd.github.star+json",
    });
    return res.data;
  }

  listHooks(fullName: string) {
    return this.paginate<GitHubHook>(`/repos/${fullName}/hooks`);
  }

  async createHook(fullName: string, body: unknown) {
    return (await this.request<GitHubHook>("POST", `/repos/${fullName}/hooks`, { body })).data;
  }

  async updateHook(fullName: string, hookId: number, body: unknown) {
    return (await this.request<GitHubHook>("PATCH", `/repos/${fullName}/hooks/${hookId}`, { body })).data;
  }

  async deleteHook(fullName: string, hookId: number) {
    await this.request("DELETE", `/repos/${fullName}/hooks/${hookId}`);
  }

  async pingHook(fullName: string, hookId: number) {
    await this.request("POST", `/repos/${fullName}/hooks/${hookId}/pings`);
  }

  /** Recent deliveries for a webhook, newest first. */
  async listHookDeliveries(fullName: string, hookId: number, perPage = 10) {
    const res = await this.request<GitHubHookDelivery[]>("GET", `/repos/${fullName}/hooks/${hookId}/deliveries`, {
      query: { per_page: perPage },
    });
    return res.data;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}
