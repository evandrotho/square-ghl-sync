const recentEvents = new Map<string, number>();
const TTL_MS = 60_000; // 1 minute

export function isDuplicate(key: string): boolean {
  const now = Date.now();

  // Clean expired entries
  for (const [k, ts] of recentEvents) {
    if (now - ts > TTL_MS) recentEvents.delete(k);
  }

  if (recentEvents.has(key)) return true;

  recentEvents.set(key, now);
  return false;
}
