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

// A single store operation (connect handshake plus INCR/EXPIRE) never takes longer than this: a wedged socket must fail the request, not hang it.
export const REDIS_OP_TIMEOUT_MS = 2500;

type Entry = { client: RedisClient; pending: Promise<RedisClient> };

// One client per server instance and url: Fluid Compute reuses instances, so connections are reused across requests.
const clients = new Map<string, Entry>();

const evict = (url: string, entry: Entry | undefined) => {
  if (entry && clients.get(url) === entry) clients.delete(url);
};

function getEntry(url: string): Entry {
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
  // Declared before the handler that reads it, so nothing depends on temporal-dead-zone timing.
  let entry: Entry | undefined;
  // Without a listener an 'error' event would crash the process, and the listener stays for the client's whole life (a destroyed
  // client can still emit). Never log the url or error detail (may hold the password). A dropped connection is not retried
  // (see reconnectStrategy), so evict this client, and only this one, and let the next request build a new one.
  client.on("error", () => {
    console.error("[rate-limit] Redis client error");
    evict(url, entry);
  });
  const pending = client.connect().then(() => client);
  entry = { client, pending };
  clients.set(url, entry);
  // Drop a failed connect so the next request retries with a fresh client.
  pending.catch(() => evict(url, entry));
  return entry;
}

class RedisTimeout extends Error {}

// Rejects after `ms`; the timer is always cleared. The losing promise is still observed by the race, so it can't become an unhandled rejection.
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RedisTimeout("Redis operation timed out")), ms); });
  try { return await Promise.race([work, timeout]); } finally { clearTimeout(timer); }
}

// Fixed window from the first hit: INCR, and set the expiry only when the key was just created.
export function redisStore(url: string): CounterStore {
  return {
    async incr(key, ttlSeconds) {
      const entry = getEntry(url);
      try {
        return await withTimeout((async () => {
          const client = await entry.pending;
          const n = await client.incr(key);
          if (n === 1) await client.expire(key, ttlSeconds);
          return n;
        })(), REDIS_OP_TIMEOUT_MS);
      } catch (e) {
        if (e instanceof RedisTimeout) {
          // Give up on the wedged client: evict it (only if it is still the cached one) and close its socket.
          evict(url, entry);
          try { entry.client.destroy(); } catch { /* already closed */ }
        }
        throw e;
      }
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
