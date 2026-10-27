import { createClient } from "redis";

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

type RedisClient = ReturnType<typeof createClient>;

// One client per server instance and url: Fluid Compute reuses instances, so connections are reused across requests.
const clients = new Map<string, Promise<RedisClient>>();

function getClient(url: string): Promise<RedisClient> {
  const cached = clients.get(url);
  if (cached) return cached;
  const client = createClient({
    url,
    socket: {
      connectTimeout: 2000,
      // Give up at once: a down store should fail the request fast (fail closed), not hang it.
      reconnectStrategy: () => new Error("Redis unavailable"),
    },
  });
  // Without a listener an 'error' event would crash the process. Never log the url or error detail (may hold the password).
  // A dropped connection is not retried (see reconnectStrategy), so evict the client and let the next request build a new one.
  client.on("error", () => {
    console.error("[rate-limit] Redis client error");
    if (clients.get(url) === pending) clients.delete(url);
  });
  const pending = client.connect().then(() => client);
  clients.set(url, pending);
  // Drop a failed connect so the next request retries with a fresh client.
  pending.catch(() => {
    if (clients.get(url) === pending) clients.delete(url);
  });
  return pending;
}

// Fixed window from the first hit: INCR, and set the expiry only when the key was just created.
export function redisStore(url: string): CounterStore {
  return {
    async incr(key, ttlSeconds) {
      const client = await getClient(url);
      const n = await client.incr(key);
      if (n === 1) await client.expire(key, ttlSeconds);
      return n;
    },
  };
}

// Production uses Redis (REDIS_URL from the Vercel Marketplace integration); without it, production returns null and the chat fails closed.
export function counterStoreFromEnv(env: NodeJS.ProcessEnv): CounterStore | null {
  if (typeof env.REDIS_URL === "string" && env.REDIS_URL !== "") return redisStore(env.REDIS_URL);
  if (env.NODE_ENV !== "production") {
    console.warn("[rate-limit] No counter store configured; using in-memory counters (development only).");
    return memoryStore();
  }
  return null;
}
