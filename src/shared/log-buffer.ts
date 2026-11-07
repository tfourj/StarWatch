export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  scope: string | null;
  msg: string;
  /** Everything else that was logged with the message. */
  fields: Record<string, unknown>;
}

export interface LogQuery {
  /** Only entries with a larger id, for incremental polling. */
  after?: number;
  minLevel?: LogLevel;
  /** Exact scope or a parent scope ("sync" also matches "sync.hooks"). */
  scope?: string;
  /** Case-insensitive text search over message, scope and fields. */
  q?: string;
  limit?: number;
}

/** Fixed-size in-memory ring of recent log entries for the admin Logs page. */
export class LogBuffer {
  private entries: LogEntry[] = [];
  private nextId = 1;

  constructor(private capacity: number) {}

  push(entry: Omit<LogEntry, "id">): LogEntry {
    const stored = { id: this.nextId++, ...entry };
    this.entries.push(stored);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
    return stored;
  }

  /** Matching entries, oldest first, keeping the newest `limit`. */
  query(options: LogQuery = {}): LogEntry[] {
    const min = options.minLevel ? LOG_LEVELS[options.minLevel] : 0;
    const q = options.q?.trim().toLowerCase();
    const scope = options.scope?.trim();
    const matches = this.entries.filter((e) => {
      if (options.after !== undefined && e.id <= options.after) return false;
      if (LOG_LEVELS[e.level] < min) return false;
      if (scope && e.scope !== scope && !e.scope?.startsWith(`${scope}.`)) return false;
      if (q) {
        const haystack = `${e.msg} ${e.scope ?? ""} ${JSON.stringify(e.fields)}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    const limit = Math.max(1, Math.min(options.limit ?? 500, this.capacity));
    return matches.slice(-limit);
  }

  scopes(): string[] {
    return [...new Set(this.entries.map((e) => e.scope).filter((s): s is string => Boolean(s)))].sort();
  }

  get lastId(): number {
    return this.nextId - 1;
  }

  clear() {
    this.entries = [];
  }
}
