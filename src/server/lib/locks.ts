const running = new Map<string, Promise<unknown>>();

/** Run `fn` once per key at a time. Concurrent callers share the in-flight promise. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = running.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => running.delete(key));
  running.set(key, promise);
  return promise;
}

export function isLocked(key: string): boolean {
  return running.has(key);
}
