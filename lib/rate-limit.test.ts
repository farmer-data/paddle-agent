import { describe, it, expect, vi, afterEach } from "vitest";
import { checkChatLimits } from "./rate-limit";
import { counterStoreFromEnv } from "./counter-store";
import type { CounterStore } from "./counter-store";

const NOW = new Date("2026-10-26T16:10:00Z");

function fakeStore(seed: Record<string, number> = {}): CounterStore {
  const m = new Map(Object.entries(seed));
  return { incr: async (key) => { const n = (m.get(key) ?? 0) + 1; m.set(key, n); return n; } };
}

afterEach(() => vi.restoreAllMocks());

describe("checkChatLimits", () => {
  it("allows 20 per hour per IP, then explains", async () => {
    const s = fakeStore();
    for (let i = 0; i < 20; i++) expect((await checkChatLimits(s, "1.1.1.1", NOW)).ok).toBe(true);
    expect(await checkChatLimits(s, "1.1.1.1", NOW)).toMatchObject({ ok: false, status: 429, message: expect.stringContaining("hourly limit") });
    expect((await checkChatLimits(s, "2.2.2.2", NOW)).ok).toBe(true);
  });
  it("names the next hour in New York time", async () => {
    const s = fakeStore({ "rl:ip:1.1.1.1:h:2026-10-26 12": 20 });
    expect(await checkChatLimits(s, "1.1.1.1", NOW)).toMatchObject({ message: "You've reached the hourly limit for the guide (20 messages). Try again after 1 PM." });
  });
  it("caps 50 per IP per day across hours", async () => {
    const s = fakeStore(); const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
    for (let i = 0; i < 50; i++) expect((await checkChatLimits(s, "1.1.1.1", at(Math.floor(i / 20)))).ok).toBe(true);
    expect(await checkChatLimits(s, "1.1.1.1", at(3))).toMatchObject({ ok: false, message: expect.stringContaining("today's limit") });
  });
  it("caps the whole site at 500 per day and does not count denied IPs against it", async () => {
    const s = fakeStore({ "rl:site:d:2026-10-26": 500 });
    expect(await checkChatLimits(s, "3.3.3.3", NOW)).toMatchObject({ ok: false, message: expect.stringContaining("resting until tomorrow") });
  });
  it("does not touch the site counter when an IP is denied", async () => {
    const keys: string[] = [];
    const s: CounterStore = { incr: async (k) => { keys.push(k); return k.startsWith("rl:ip:") ? 1000 : 1; } };
    await checkChatLimits(s, "4.4.4.4", NOW);
    expect(keys.some((k) => k.startsWith("rl:site:"))).toBe(false);
  });
  it("fails closed when the store is missing or throws", async () => {
    expect(await checkChatLimits(null, "1.1.1.1", NOW)).toEqual({ ok: false, status: 503, message: "The guide is unavailable right now" });
    expect((await checkChatLimits({ incr: async () => { throw new Error("down"); } }, "1.1.1.1", NOW)).ok).toBe(false);
  });
});

describe("counterStoreFromEnv", () => {
  it("uses memory only outside production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(counterStoreFromEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(counterStoreFromEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
