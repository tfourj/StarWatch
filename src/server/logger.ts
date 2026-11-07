import { LOG_LEVELS as LEVELS, logBuffer, type LogLevel as Level } from "./log-buffer";

function threshold(): number {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return LEVELS[env] ?? LEVELS.info;
}

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return err;
}

function write(level: Level, scope: string | undefined, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < threshold()) return;
  const entry: Record<string, unknown> = { time: new Date().toISOString(), level, msg };
  if (scope) entry.scope = scope;
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      entry[key] = key === "err" || key === "error" ? serializeError(value) : value;
    }
  }
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");

  // Keep a detached copy for the Logs page, split into the fixed parts and the extra fields.
  const { time, level: _level, msg: _msg, scope: _scope, ...rest } = JSON.parse(line) as Record<string, unknown>;
  logBuffer.push({ time: time as string, level, scope: scope ?? null, msg, fields: rest });
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(scope?: string): Logger {
  return {
    debug: (msg, fields) => write("debug", scope, msg, fields),
    info: (msg, fields) => write("info", scope, msg, fields),
    warn: (msg, fields) => write("warn", scope, msg, fields),
    error: (msg, fields) => write("error", scope, msg, fields),
    child: (child) => createLogger(scope ? `${scope}.${child}` : child),
  };
}

export const logger = createLogger();
