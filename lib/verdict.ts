import { CONFIG, type Mode } from "./config";
import { angleDiff } from "./geo";
import type { Zone } from "./zones";

export type Risk = "safe" | "caution" | "danger";
export type Verdict = Risk | "unknown";
export type SourceId = "wind" | "current" | "alerts" | "flow";
export type HourConditions = {
  windKnots: number | null; windFromDeg: number | null;
  currentSigned: number | null; // + flood, − ebb
  currentTowardDeg: number | null;
  dischargeCfs: number | null;
  alerts: string[] | null; // null = unknown
  daylight: boolean;
};
export type HourAssessment = { verdict: Verdict; opposing: boolean; missing: SourceId[]; reasons: string[] };

const LEVELS: Risk[] = ["safe", "caution", "danger"];
const band = (v: number, t: { caution: number; danger: number }): number => (v > t.danger ? 2 : v >= t.caution ? 1 : 0);

export const cardinal = (deg: number) =>
  ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

// "Small Craft Advisory for Hazardous Seas/Winds" and similar variants all count.
const isNoGoAlert = (event: string) => (CONFIG.noGoAlerts as readonly string[]).includes(event) || event.startsWith("Small Craft Advisory");

export function assessHour(c: HourConditions, zone: Zone, mode: Mode): HourAssessment {
  const t = CONFIG.thresholds[mode];
  const { windKnots, windFromDeg, currentSigned, currentTowardDeg, dischargeCfs, alerts } = c;

  const missing: SourceId[] = [];
  if (windKnots === null || windFromDeg === null) missing.push("wind");
  if (currentSigned === null) missing.push("current");
  if (alerts === null) missing.push("alerts");
  if (zone.usesHudsonFlow && dischargeCfs === null) missing.push("flow");

  const opposing = currentSigned !== null && windFromDeg !== null && currentTowardDeg !== null
    && Math.abs(currentSigned) >= CONFIG.opposing.minCurrentKn
    && angleDiff(windFromDeg, currentTowardDeg) <= CONFIG.opposing.maxAngleDeg;

  // Present factors with their bands; reasons are sorted by band, most severe first.
  const factors: { band: number; text: string }[] = [];
  if (windKnots !== null && windFromDeg !== null) {
    const b = Math.min(2, band(windKnots, t.wind) + (opposing ? 1 : 0));
    factors.push({ band: b, text: `Wind ${Math.round(windKnots)} kn from ${cardinal(windFromDeg)}${opposing ? ", against the current" : ""}` });
  }
  if (currentSigned !== null) {
    factors.push({ band: band(Math.abs(currentSigned), t.current), text: `Current ${Math.abs(currentSigned).toFixed(1)} kn ${currentSigned < 0 ? "ebb" : "flood"}` });
  }
  if (zone.usesHudsonFlow && dischargeCfs !== null) {
    factors.push({ band: band(dischargeCfs, CONFIG.thresholds.flow), text: `Hudson flow ${dischargeCfs.toLocaleString("en-US")} cfs` });
  }

  const blockers: string[] = [];
  if (!c.daylight) blockers.push("Outside daylight hours");
  if (mode === "beginner" && zone.beginnerNoGo) blockers.push(`${zone.name} — Not for first-season paddlers`);
  for (const a of alerts ?? []) if (isNoGoAlert(a)) blockers.push(`${a} in effect`);

  const reasons = [...blockers, ...factors.sort((a, b) => b.band - a.band).map((f) => f.text)];
  const top = Math.max(0, ...factors.map((f) => f.band));

  const verdict: Verdict = blockers.length || top === 2 ? "danger" : missing.length ? "unknown" : LEVELS[top];
  return { verdict, opposing, missing, reasons };
}
