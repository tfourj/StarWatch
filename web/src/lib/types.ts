import type { MessageTemplates } from "@shared/templates";

export type Role = "admin" | "user";
export type RepoMode = "webhook" | "polling" | "both";
export type HookStatus = "none" | "active" | "missing" | "error";
export type DeliveryStatus = "pending" | "retrying" | "success" | "failed";

export interface SetupStatus {
  needsSetup: boolean;
  registrationOpen: boolean;
  githubOAuth: boolean;
  version: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
}

export interface RateLimit {
  limit: number;
  remaining: number;
  resetAt: number;
  blockedUntil: number;
}

export interface EventSummary {
  id: number;
  action: "created" | "deleted";
  actorLogin: string;
  actorAvatarUrl: string | null;
  actorUrl: string | null;
  starCount: number;
  source: "webhook" | "polling";
  occurredAt: string;
  repoFullName: string;
  repoUrl: string;
}

export interface Dashboard {
  stats: {
    totalStars: number;
    repositories: number;
    monitored: number;
    starsToday: number;
    stars7d: number;
    stars30d: number;
    hookErrors: number;
    failedDeliveries: number;
  };
  chart: { date: string; stars: number; unstars: number }[];
  recentEvents: EventSummary[];
  topRepos: { id: number; fullName: string; htmlUrl: string; starCount: number }[];
  github: {
    connected: boolean;
    login: string | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    rateLimit: RateLimit | null;
  };
  timezone: string;
}

export interface Repo {
  id: number;
  githubId: number;
  fullName: string;
  name: string;
  owner: string;
  htmlUrl: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  starCount: number;
  monitored: boolean;
  mode: RepoMode;
  hookId: number | null;
  hookStatus: HookStatus;
  hookError: string | null;
  hookCheckedAt: string | null;
  backfilledAt: string | null;
  backfillError: string | null;
  lastPolledAt: string | null;
  channelIds: number[];
}

export interface ChannelSummary {
  id: number;
  name: string;
  type: string;
  allRepos: boolean;
  enabled: boolean;
}

export interface ReposResponse {
  repos: Repo[];
  channels: ChannelSummary[];
  webhookUrl: string;
  hasToken: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface SyncSummary {
  repos: number;
  added: number;
  removed: number;
  hooksCreated: number;
  hooksRepaired: number;
  hooksDeleted: number;
  hookErrors: number;
}

export interface Stargazer {
  githubUserId: number;
  login: string;
  avatarUrl: string | null;
  starredAt: string | null;
}

export interface StargazersResponse {
  items: Stargazer[];
  total: number;
  page: number;
  pageSize: number;
  repo: {
    id: number;
    fullName: string;
    htmlUrl: string;
    starCount: number;
    backfilledAt: string | null;
    backfillError: string | null;
  };
}

export interface BulkMonitoringResult {
  updated: number;
  hooksPending: number;
}

export interface Delivery {
  id: number;
  channelId: number;
  channelName: string;
  channelType: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
}

export interface EventRow extends EventSummary {
  actorId: number;
  repositoryId: number;
  deliveries: Delivery[];
}

export interface EventsResponse {
  items: EventRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DeliveryAttempt {
  id: number;
  attempt: number;
  success: boolean;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

export interface Channel {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  allRepos: boolean;
  notifyStar: boolean;
  notifyUnstar: boolean;
  milestoneEvery: number | null;
  templates: Partial<MessageTemplates> | null;
  config: Record<string, string | number | boolean>;
  secrets: Record<string, string | null>;
  repoIds: number[];
}

export interface Settings {
  github: {
    connected: boolean;
    login: string | null;
    tokenHint: string | null;
    scopes: string[] | null;
    missingScopes: string[];
    warnings: string[];
    checkedAt: string | null;
    rateLimit: RateLimit | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    lastPollAt: string | null;
  };
  pollingIntervalMinutes: number;
  autoMonitorNew: boolean;
  templates: MessageTemplates;
  defaultTemplates: MessageTemplates;
  webhook: { url: string; baseUrlOverride: string | null; defaultBaseUrl: string; canEdit: boolean };
  server: { timezone: string; allowRegistration: boolean };
}

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  image: string | null;
  createdAt: string;
  isSelf: boolean;
}
