import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type FakeClient = {
  on: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
};

const clients: FakeClient[] = [];
const state = { connect: (): Promise<unknown> => Promise.resolve(), incr: (): Promise<number> => Promise.resolve(1) };
const createClient = vi.fn((_opts: unknown) => {
  const c: FakeClient = {
    on: vi.fn(),
    connect: vi.fn(() => state.connect()),
    incr: vi.fn(() => state.incr()),
    expire: vi.fn(async () => 1),
  };
  c.on.mockReturnValue(c);
  clients.push(c);
  return c;
});

vi.mock("redis", () => ({ createClient: (opts: unknown) => createClient(opts) }));

async function load() {
  vi.resetModules();
  return import("./counter-store");
}

beforeEach(() => {
  clients.length = 0;
  createClient.mockClear();
  state.connect = () => Promise.resolve();
  state.incr = () => Promise.resolve(1);
});
afterEach(() => vi.restoreAllMocks());

describe("counterStoreFromEnv with REDIS_URL", () => {
  it("returns a redis-backed store in production without connecting until first use", async () => {
    const { counterStoreFromEnv } = await load();
    const store = counterStoreFromEnv({ NODE_ENV: "production", REDIS_URL: "redis://x" } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    await store!.incr("k", 60);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(clients[0].connect).toHaveBeenCalledTimes(1);
  });

  it("ignores an empty REDIS_URL", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { counterStoreFromEnv } = await load();
    expect(counterStoreFromEnv({ NODE_ENV: "production", REDIS_URL: "" } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("redisStore", () => {
  it("sets the expiry only when the count is 1, with the given TTL", async () => {
    const { redisStore } = await load();
    const store = redisStore("redis://x");
    state.incr = () => Promise.resolve(1);
    expect(await store.incr("a", 3600)).toBe(1);
    expect(clients[0].incr).toHaveBeenCalledWith("a");
    expect(clients[0].expire).toHaveBeenCalledWith("a", 3600);
    clients[0].expire.mockClear();
    state.incr = () => Promise.resolve(2);
    expect(await store.incr("a", 3600)).toBe(2);
    expect(clients[0].expire).not.toHaveBeenCalled();
  });

  it("shares one connect between concurrent first calls and reuses the client", async () => {
    const { redisStore } = await load();
    const store = redisStore("redis://x");
    await Promise.all([store.incr("a", 1), store.incr("b", 1)]);
    await store.incr("c", 1);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(clients[0].connect).toHaveBeenCalledTimes(1);
  });

  it("uses short timeouts, a bounded reconnect strategy and an error handler", async () => {
    const { redisStore } = await load();
    await redisStore("redis://x").incr("a", 1);
    const opts = createClient.mock.calls[0][0] as { url: string; socket: { connectTimeout: number; reconnectStrategy: (n: number) => unknown } };
    expect(opts.url).toBe("redis://x");
    expect(opts.socket.connectTimeout).toBeLessThanOrEqual(2000);
    expect(opts.socket.reconnectStrategy(5)).toBeInstanceOf(Error);
    expect(clients[0].on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("rejects on a failed connect and retries with a new client next time", async () => {
    const { redisStore } = await load();
    const store = redisStore("redis://x");
    state.connect = () => Promise.reject(new Error("refused"));
    await expect(store.incr("a", 1)).rejects.toThrow("refused");
    state.connect = () => Promise.resolve();
    expect(await store.incr("a", 1)).toBe(1);
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it("rejects when a command fails", async () => {
    const { redisStore } = await load();
    const store = redisStore("redis://x");
    state.incr = () => Promise.reject(new Error("boom"));
    await expect(store.incr("a", 1)).rejects.toThrow("boom");
  });

  it("does not log the url on error events", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { redisStore } = await load();
    await redisStore("redis://user:secret@host").incr("a", 1);
    const handler = clients[0].on.mock.calls.find((c) => c[0] === "error")![1] as (e: Error) => void;
    handler(new Error("ECONNRESET"));
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});

describe("redisStore after a dropped connection", () => {
  it("evicts the client on an error event so the next call reconnects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { redisStore } = await load();
    const store = redisStore("redis://x");
    await store.incr("a", 1);
    const handler = clients[0].on.mock.calls.find((c) => c[0] === "error")![1] as (e: Error) => void;
    handler(new Error("ECONNRESET"));
    await store.incr("a", 1);
    expect(createClient).toHaveBeenCalledTimes(2);
  });
});
