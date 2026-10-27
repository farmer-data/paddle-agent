// Browser-safe: no server-only imports.
import { bestWindow, type ZoneOutlook } from "./outlook";
import type { RequestTrip } from "./trips";
import type { TargetWindow } from "./when";
import { PLACES, zoneById } from "./zones";

export type ForecastSummary = {
  available: boolean;
  label: string;
  date: string;
  hours: number;
  windKnots: number | null; // null only when available is false: no in-window hour has wind
  windDirection: string;
  currentKnots: number | null;
  currentPhase: "ebb" | "flood" | null;
  verdict: "safe" | "caution" | "danger" | null;
  opposingWind: boolean;
  opposingPhase: "ebb" | "flood" | null;
};

const round = (value: number, places = 1) => Number(value.toFixed(places));
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// The request carries no route text, so a trip is labelled by its launch or, failing that, its zone.
const tripLabel = (t: RequestTrip) => PLACES.find((p) => p.id === t.placeId)?.name ?? zoneById(t.zoneId).name;

export function roughTripStats(trips: RequestTrip[]) {
  const rows = trips
    .filter((t) => t.rating === "rough" && t.snapshot)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 8)
    .map((t) => ({ trip_id: t.tripId, route: tripLabel(t), started_at: t.startedAt, wind: t.snapshot!.windKnots, current: t.snapshot!.currentKnots }));
  const winds = rows.map((r) => r.wind), currents = rows.map((r) => r.current);
  return {
    stats: { rough_trips: rows.length, median_wind: round(median(winds)), avg_wind: round(avg(winds)), median_current: round(median(currents), 2), avg_current: round(avg(currents), 2) },
    trips: rows,
  };
}

export function windowForecast(outlook: ZoneOutlook, target: TargetWindow): ForecastSummary {
  const hours = target.isNow
    ? outlook.hours.slice(0, 12)
    : outlook.hours.filter((h) => h.key.slice(0, 10) === target.date && Number(h.key.slice(11)) >= target.startHour && Number(h.key.slice(11)) < target.endHour);
  if (!hours.length) {
    return { available: false, label: target.label, date: target.date, hours: 0, windKnots: null, windDirection: "", currentKnots: null, currentPhase: null, verdict: null, opposingWind: false, opposingPhase: null };
  }
  const withWind = hours.filter((h) => h.windKnots !== null);
  // Missing wind is not calm: with no wind in the window there is nothing to compare.
  if (!withWind.length) {
    return { available: false, label: target.label, date: target.date, hours: hours.length, windKnots: null, windDirection: "", currentKnots: null, currentPhase: null, verdict: null, opposingWind: false, opposingPhase: null };
  }
  const windiest = withWind.length ? withWind.reduce((best, h) => (h.windKnots! > best.windKnots! ? h : best)) : null;
  const withCurrent = hours.filter((h) => h.current !== null);
  const strongest = withCurrent.length ? withCurrent.reduce((best, h) => (Math.abs(h.current!) > Math.abs(best.current!) ? h : best)) : null;
  const best = bestWindow(hours);
  const known = hours.some((h) => h.risk !== "unknown");
  const verdict = best.kind === "green" ? "safe" : best.kind === "leastRisky" ? "caution" : known ? "danger" : null;
  const scope = best.kind === "none" ? hours : hours.filter((h) => h.key >= best.startKey && h.key <= best.endKey);
  const opposingHour = scope.find((h) => h.opposing && h.current !== null);
  return {
    available: true,
    label: target.label,
    date: target.date,
    hours: hours.length,
    windKnots: round(median(withWind.map((h) => h.windKnots!))),
    windDirection: windiest?.direction ?? "",
    currentKnots: withCurrent.length ? round(median(withCurrent.map((h) => Math.abs(h.current!))), 2) : null,
    currentPhase: strongest ? (strongest.current! < 0 ? "ebb" : "flood") : null,
    verdict,
    opposingWind: scope.some((h) => h.opposing),
    opposingPhase: opposingHour ? (opposingHour.current! < 0 ? "ebb" : "flood") : null,
  };
}
