// Server-side: calls the NOAA fetchers.
import type { Mode } from "./config";
import { buildZoneOutlook, type OutlookInputs } from "./outlook";
import { fetchCurrentSeries, fetchWindHistory } from "./sources";
import { nyStamp, wallMinutes } from "./time";
import type { TripSnapshot } from "./trips";
import { assessHour } from "./verdict";
import { zoneById, type ZoneId } from "./zones";

const WITHIN_MIN = 60;

const nearest = <T extends { ts: string }>(items: T[], target: number): T | null => {
  let best: T | null = null, bestD = Infinity;
  for (const it of items) {
    const d = Math.abs(wallMinutes(it.ts) - target);
    if (d <= WITHIN_MIN && d < bestD) { best = it; bestD = d; }
  }
  return best;
};

// startedAt is a New York wall-clock stamp, "YYYY-MM-DD HH:MM".
export async function tripSnapshot(zoneId: ZoneId, startedAt: string, mode: Mode, now: Date, inputs: OutlookInputs): Promise<TripSnapshot | null> {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(startedAt)) return null;
  const at = wallMinutes(startedAt);
  const delta = at - wallMinutes(nyStamp(now));
  if (!Number.isFinite(delta) || delta > WITHIN_MIN) return null;

  if (delta >= -WITHIN_MIN) {
    const hours = buildZoneOutlook(inputs, zoneId, mode, now).hours;
    const h = hours.find((x) => x.key === startedAt.slice(0, 13)) ?? hours[0];
    if (!h || h.windKnots === null || h.current === null) return null;
    return { windKnots: h.windKnots, windFromDeg: h.windFromDeg, currentKnots: Math.abs(h.current), currentPhase: h.current < 0 ? "ebb" : "flood", verdict: h.risk };
  }

  try {
    const zone = { ...zoneById(zoneId), usesHudsonFlow: false };
    const date = startedAt.slice(0, 10);
    const [history, series] = await Promise.all([fetchWindHistory(date), fetchCurrentSeries(zone.currentStation, date)]);
    const wind = nearest(history, at);
    const cur = nearest(series, at);
    if (!wind || !cur) return null;
    const a = assessHour({
      windKnots: wind.knots, windFromDeg: wind.fromDeg, currentSigned: cur.signed, currentTowardDeg: cur.towardDeg,
      dischargeCfs: null, alerts: [], daylight: true,
    }, zone, mode);
    return { windKnots: wind.knots, windFromDeg: wind.fromDeg, currentKnots: Math.abs(cur.signed), currentPhase: cur.signed < 0 ? "ebb" : "flood", verdict: a.verdict };
  } catch { return null; }
}
