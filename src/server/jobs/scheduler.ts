import { lt } from "drizzle-orm";
import { affected, getDb } from "../db/client";
import { webhookDeliveries } from "../db/schema";
import { logger } from "../logger";
import { processDueDeliveries } from "../notifications/worker";
import { syncFollowers } from "../services/followers";
import { pollUser } from "../services/polling";
import { syncRepositories } from "../services/repos";
import { listUsersWithTokens } from "../services/settings";

const log = logger.child("jobs");

const DELIVERY_TICK_MS = 10_000;
const POLL_TICK_MS = 60_000;
const SYNC_INTERVAL_MS = Math.max(5, Number(process.env.SYNC_INTERVAL_MINUTES ?? 60)) * 60_000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;

const timers: Timer[] = [];

async function pollTick() {
  const now = Date.now();
  for (const settings of listUsersWithTokens()) {
    const interval = Math.max(1, settings.pollingIntervalMinutes) * 60_000;
    const due = (last: Date | null) => !last || now - last.getTime() >= interval;
    if (due(settings.lastPollAt)) {
      await pollUser(settings.userId).catch((err) => log.error("poll job failed", { userId: settings.userId, err }));
    }
    if (settings.followersEnabled && due(settings.followersCheckedAt)) {
      await syncFollowers(settings.userId).catch(() => {
        // already logged and stored on the user settings
      });
    }
  }
}

async function syncTick() {
  for (const settings of listUsersWithTokens()) {
    await syncRepositories(settings.userId).catch(() => {
      // already logged and stored on the user settings
    });
  }
}

function cleanupTick() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const removed = affected(getDb().delete(webhookDeliveries).where(lt(webhookDeliveries.receivedAt, cutoff)).run());
  if (removed) log.info("old webhook delivery ids removed", { removed });
}

function every(ms: number, fn: () => unknown) {
  let busy = false;
  timers.push(
    setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await fn();
      } catch (err) {
        log.error("job failed", { err });
      } finally {
        busy = false;
      }
    }, ms),
  );
}

export function startScheduler() {
  every(DELIVERY_TICK_MS, processDueDeliveries);
  every(POLL_TICK_MS, pollTick);
  every(SYNC_INTERVAL_MS, syncTick);
  every(CLEANUP_INTERVAL_MS, cleanupTick);
  timers.push(setTimeout(() => void syncTick(), 15_000));
  void processDueDeliveries();
  log.info("scheduler started", { syncIntervalMinutes: SYNC_INTERVAL_MS / 60_000 });
}

export function stopScheduler() {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}
