export type CounterStore = { incr(key: string, ttlSeconds: number): Promise<number> };

// Development only: counters live in this process and reset on restart.
export function memoryStore(): CounterStore {
  const m = new Map<string, { n: number; expires: number }>();
  return {
    async incr(key, ttlSeconds) {
      const now = Date.now();
      const cur = m.get(key);
      const n = cur && cur.expires > now ? cur.n + 1 : 1;
      m.set(key, { n, expires: n === 1 ? now + ttlSeconds * 1000 : cur!.expires });
      return n;
    },
  };
}

// A production provider adapter goes here as one branch keyed on that provider's env vars.
// Until one is connected, production returns null and the chat fails closed.
export function counterStoreFromEnv(env: NodeJS.ProcessEnv): CounterStore | null {
  if (env.NODE_ENV !== "production") {
    console.warn("[rate-limit] No counter store configured; using in-memory counters (development only).");
    return memoryStore();
  }
  return null;
}
