import { CONFIG } from "./config";
import type { CounterStore } from "./counter-store";
import { hourLabel, nyParts } from "./time";

export type LimitResult = { ok: true } | { ok: false; status: 429 | 503; message: string };

const HOUR_TTL_S = 3600;
const DAY_TTL_S = 86_400;
const UNAVAILABLE: LimitResult = { ok: false, status: 503, message: "The guide is unavailable right now" };

export async function checkChatLimits(store: CounterStore | null, ip: string, now: Date): Promise<LimitResult> {
  if (!store) return UNAVAILABLE;
  const { date, hour } = nyParts(now);
  const { perIpHour, perIpDay, siteDay } = CONFIG.rateLimit;
  try {
    const hourCount = await store.incr(`rl:ip:${ip}:h:${date} ${String(hour).padStart(2, "0")}`, HOUR_TTL_S);
    const dayCount = await store.incr(`rl:ip:${ip}:d:${date}`, DAY_TTL_S);
    if (hourCount > perIpHour) {
      return { ok: false, status: 429, message: `You've reached the hourly limit for the guide (${perIpHour} messages). Try again after ${hourLabel((hour + 1) % 24)}.` };
    }
    if (dayCount > perIpDay) {
      return { ok: false, status: 429, message: `You've reached today's limit for the guide (${perIpDay} messages). It resets at midnight.` };
    }
    const siteCount = await store.incr(`rl:site:d:${date}`, DAY_TTL_S);
    if (siteCount > siteDay) {
      return { ok: false, status: 429, message: `The guide is resting until tomorrow — it has answered its ${siteDay} questions for today. Conditions, the map and the route planner still work.` };
    }
    return { ok: true };
  } catch {
    return UNAVAILABLE;
  }
}
