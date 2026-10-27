// Pure: raw upstream data in, what paddlers see out. Runs on the server and in the browser.
import { CONFIG, type Mode } from "./config";
import type { Alert, CurrentPoint, WindPeriod } from "./sources";
import { hourKey, hourLabel, nyParts, nyStamp, nyWallToDate, sunTimes, wallMinutes, addDays } from "./time";
import { assessHour, cardinal, type SourceId, type Verdict } from "./verdict";
import { zoneById, type ZoneId } from "./zones";

export type ZoneInputs = { zoneId: ZoneId; wind: { periods: WindPeriod[]; updatedAt: string } | null; current: CurrentPoint[] | null; alerts: Alert[] | null };
export type OutlookInputs = { generatedAt: string; zones: ZoneInputs[]; discharge: { cfs: number; at: string } | null; water: { f: number; at: string } | null; rain48hIn: number | null };
export type HourView = {
  key: string; ts: string; hourLabel: string;
  windKnots: number | null; windFromDeg: number | null; direction: string | null;
  current: number | null; currentTowardDeg: number | null;
  risk: Verdict; opposing: boolean; daylight: boolean; missing: SourceId[]; reasons: string[];
};
export type BestWindow =
  | { kind: "green" | "leastRisky"; startKey: string; endKey: string; startLabel: string; endLabel: string }
  | { kind: "none" };
export type CurrentSummary = {
  nextTurn: { atLabel: string; toPhase: "ebb" | "flood" } | null;
  peakEbb: { atLabel: string; knots: number } | null;
  peakFlood: { atLabel: string; knots: number } | null;
};
export type CurrentNow = { nowSigned: number; caption: string; summary: CurrentSummary };
export type ZoneOutlook = {
  zoneId: ZoneId; zoneName: string; mode: Mode;
  hours: HourView[];
  strip: { label: "Today" | "Tomorrow"; hours: HourView[] };
  best: BestWindow; currentNow: CurrentNow | null; gear: string | null; rainBadge: string | null;
  alerts: string[]; waterTempF: number | null; sun: { sunrise: string; sunset: string };
  unavailable: string[]; updatedAt: string;
};

export const SOURCE_LABEL: Record<SourceId, string> = { wind: "NWS wind forecast", current: "NOAA currents", alerts: "NWS marine warnings", flow: "USGS river flow" };
const COLD_GEAR = "wetsuit or drysuit required";
const RAIN_BADGE = "Recent heavy rain — sewage overflow likely, avoid water contact";

// ISO instants (USGS) carry an offset; NOAA stamps ("YYYY-MM-DD HH:MM") are New York wall time.
const ageMin = (at: string, now: Date) =>
  /Z$|[+-]\d\d:?\d\d$/.test(at) ? (now.getTime() - Date.parse(at)) / 60_000 : wallMinutes(nyStamp(now)) - wallMinutes(at);
const fresh = (at: string, now: Date) => ageMin(at, now) <= CONFIG.maxAge.observationMin;

export function gearLine(water: { f: number; at: string } | null, now: Date): string | null {
  if (water && fresh(water.at, now)) return water.f < CONFIG.coldWaterF ? `Water ${Math.round(water.f)} °F — ${COLD_GEAR}` : null;
  const month = Number(nyParts(now).date.slice(5, 7));
  return (CONFIG.coldSeasonMonths as readonly number[]).includes(month) ? `Water temperature unavailable — assume cold, ${COLD_GEAR}` : null;
}

export function bestWindow(hours: HourView[]): BestWindow {
  for (const [risk, kind] of [["safe", "green"], ["caution", "leastRisky"]] as const) {
    let best: [number, number] | null = null;
    let start = -1;
    for (let i = 0; i <= hours.length; i++) {
      if (i < hours.length && hours[i].risk === risk) { if (start === -1) start = i; }
      else if (start !== -1) { if (!best || i - start > best[1] - best[0] + 1) best = [start, i - 1]; start = -1; }
    }
    if (best) {
      const [a, b] = best;
      return { kind, startKey: hours[a].key, endKey: hours[b].key, startLabel: hours[a].hourLabel, endLabel: hourLabel((Number(hours[b].key.slice(11)) + 1) % 24) };
    }
  }
  return { kind: "none" };
}

export function bestWindowText(b: BestWindow, label: "Today" | "Tomorrow" = "Today"): { primary: string; secondary: string | null } {
  const day = label.toLowerCase();
  if (b.kind === "green") return { primary: `🟢 Best ${day}: ${b.startLabel}–${b.endLabel}`, secondary: null };
  return { primary: `No 🟢 window ${day}`, secondary: b.kind === "leastRisky" ? `Least risky: 🟡 ${b.startLabel}–${b.endLabel}` : null };
}

const clockLabel = (mins: number) => {
  const h = Math.floor(mins / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mins % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const minutesOf = (ts: string) => Number(ts.slice(11, 13)) * 60 + Number(ts.slice(14, 16));

export function summarizeCurrent(points: CurrentPoint[], startKey: string, endKey: string): CurrentSummary {
  const series = points.map((p) => ({ ts: p.ts, key: hourKey(p.ts), signed: p.signed })).sort((a, b) => a.ts.localeCompare(b.ts));
  let peakEbb: CurrentSummary["peakEbb"] = null;
  let peakFlood: CurrentSummary["peakFlood"] = null;
  for (const s of series) {
    if (s.key < startKey || s.key > endKey) continue;
    const label = hourLabel(Number(s.ts.slice(11, 13)));
    if (s.signed < 0 && (!peakEbb || -s.signed > peakEbb.knots)) peakEbb = { atLabel: label, knots: -s.signed };
    if (s.signed > 0 && (!peakFlood || s.signed > peakFlood.knots)) peakFlood = { atLabel: label, knots: s.signed };
  }
  let nextTurn: CurrentSummary["nextTurn"] = null;
  const fromStart = series.filter((s) => s.key >= startKey);
  for (let i = 1; i < fromStart.length; i++) {
    const a = fromStart[i - 1], b = fromStart[i];
    if (a.signed === 0 || b.signed === 0) continue;
    if (a.signed < 0 !== b.signed < 0) {
      const frac = Math.abs(a.signed) / (Math.abs(a.signed) + Math.abs(b.signed));
      nextTurn = { atLabel: clockLabel(Math.round(minutesOf(a.ts) + frac * (minutesOf(b.ts) - minutesOf(a.ts)))), toPhase: b.signed < 0 ? "ebb" : "flood" };
      break;
    }
  }
  return { nextTurn, peakEbb, peakFlood };
}

const captionFor = (signed: number) =>
  Math.abs(signed) < 0.2 ? "Slack water — the river is holding its breath."
    : signed < 0 ? "Ebb — a free ride out, earned back on return."
      : "Flood — you earn every stroke heading out.";

export function buildZoneOutlook(inputs: OutlookInputs, zoneId: ZoneId, mode: Mode, now: Date, from?: Date): ZoneOutlook {
  const zone = zoneById(zoneId);
  const zi = inputs.zones.find((z) => z.zoneId === zoneId) ?? { zoneId, wind: null, current: null, alerts: null };

  const windStale = !zi.wind || now.getTime() - Date.parse(zi.wind.updatedAt) > CONFIG.maxAge.forecastHours * 3_600_000;
  const windByKey = new Map<string, WindPeriod>();
  for (const p of windStale ? [] : zi.wind!.periods) if (!windByKey.has(hourKey(p.ts))) windByKey.set(hourKey(p.ts), p);
  const currentByKey = new Map<string, CurrentPoint>();
  for (const p of zi.current ?? []) if (p.ts.slice(14, 16) === "00" && !currentByKey.has(hourKey(p.ts))) currentByKey.set(hourKey(p.ts), p);
  const discharge = inputs.discharge && fresh(inputs.discharge.at, now) ? inputs.discharge.cfs : null;
  const sunByDate = new Map<string, { sunrise: string; sunset: string }>();
  const sunOf = (date: string) => { if (!sunByDate.has(date)) sunByDate.set(date, sunTimes(date, zone.center)); return sunByDate.get(date)!; };

  const hoursFrom = (start: Date): HourView[] => {
    const out: HourView[] = [];
    const seen = new Set<string>();
    const p0 = nyParts(start);
    for (let t = nyWallToDate(p0.date, p0.hour).getTime(); out.length < CONFIG.outlookHours; t += 3_600_000) {
      const stamp = nyStamp(new Date(t));
      const key = stamp.slice(0, 13);
      if (seen.has(key)) continue; // repeated DST hour: keep the first
      seen.add(key);
      const wall = wallMinutes(stamp);
      const sun = sunOf(key.slice(0, 10));
      const daylight = wall >= wallMinutes(sun.sunrise) && wall + 60 <= wallMinutes(sun.sunset);
      const wind = windByKey.get(key);
      const cur = currentByKey.get(key);
      const active = zi.alerts === null ? null : zi.alerts.filter((a) => a.endsAt === null || t < Date.parse(a.endsAt)).map((a) => a.event);
      const a = assessHour({
        windKnots: wind?.windKnots ?? null, windFromDeg: wind?.fromDeg ?? null,
        currentSigned: cur?.signed ?? null, currentTowardDeg: cur?.towardDeg ?? null,
        dischargeCfs: discharge, alerts: active, daylight,
      }, zone, mode);
      out.push({
        key, ts: `${key}:00`, hourLabel: hourLabel(Number(key.slice(11))),
        windKnots: wind?.windKnots ?? null, windFromDeg: wind?.fromDeg ?? null, direction: wind ? wind.direction || cardinal(wind.fromDeg) : null,
        current: cur?.signed ?? null, currentTowardDeg: cur?.towardDeg ?? null,
        risk: a.verdict, opposing: a.opposing, daylight, missing: a.missing, reasons: a.reasons,
      });
    }
    return out;
  };

  const fromNow = hoursFrom(now);
  const hours = from ? hoursFrom(from) : fromNow;

  const { date: today } = nyParts(now);
  const sun = sunOf(today);
  const beforeSunset = wallMinutes(nyStamp(now)) < wallMinutes(sun.sunset);
  const stripDate = beforeSunset ? today : addDays(today, 1);
  const strip = { label: beforeSunset ? "Today" as const : "Tomorrow" as const, hours: fromNow.filter((x) => x.daylight && x.key.slice(0, 10) === stripDate) };

  const missing = new Set(hours.flatMap((x) => x.missing));
  const unavailable = (Object.keys(SOURCE_LABEL) as SourceId[]).filter((s) => missing.has(s)).map((s) => `Couldn't reach ${SOURCE_LABEL[s]}`);
  const waterFresh = inputs.water && fresh(inputs.water.at, now) ? inputs.water : null;
  if (!waterFresh) unavailable.push("Couldn't reach NOAA water temperature");
  if (inputs.rain48hIn === null) unavailable.push("Couldn't reach rainfall data");

  const nowKey = fromNow[0].key;
  const nowPoint = currentByKey.get(nowKey);
  const currentNow: CurrentNow | null = nowPoint
    ? { nowSigned: nowPoint.signed, caption: captionFor(nowPoint.signed), summary: summarizeCurrent(zi.current!, nowKey, fromNow[fromNow.length - 1].key) }
    : null;

  return {
    zoneId, zoneName: zone.name, mode, hours, strip, best: bestWindow(strip.hours), currentNow,
    gear: gearLine(inputs.water, now),
    rainBadge: inputs.rain48hIn !== null && inputs.rain48hIn >= CONFIG.rainBadgeInches48h ? RAIN_BADGE : null,
    alerts: [...new Set((zi.alerts ?? []).filter((a) => a.endsAt === null || now.getTime() < Date.parse(a.endsAt)).map((a) => a.event))],
    waterTempF: waterFresh?.f ?? null, sun, unavailable, updatedAt: inputs.generatedAt,
  };
}
