import type { Risk } from "./safety";
import { fetchCurrentPredictions, fetchNwsHourlyWind, type CurrentPrediction } from "./sources";
import { resolveWindow } from "./when";
import { assessWindow, buildHourlyOutlook } from "./windows";

export type ForecastSummary = {
  available: boolean;
  label: string;
  date: string;
  hours: number;
  windKnots: number;
  windDirection: string;
  currentKnots: number | null;
  currentPhase: "ebb" | "flood" | null;
  verdict: Risk | null;
  opposingWind: boolean;
};

const round = (value: number, places = 1) => Number(value.toFixed(places));
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Summarize the forecast for an upcoming window (e.g. "Sunday morning") from the live
// NWS wind + NOAA current predictions — the future/forecast half of the OLAP comparison.
export async function forecastForWindow(when: string, dischargeCfs?: number): Promise<ForecastSummary> {
  const target = resolveWindow(when);
  const [wind, currents] = await Promise.all([
    fetchNwsHourlyWind(),
    fetchCurrentPredictions(target.date).catch(() => [] as CurrentPrediction[]),
  ]);
  const outlook = buildHourlyOutlook(wind, currents, { dischargeCfs }, target);

  if (!outlook.length) {
    return { available: false, label: target.label, date: target.date, hours: 0, windKnots: 0, windDirection: "", currentKnots: null, currentPhase: null, verdict: null, opposingWind: false };
  }

  const windiest = outlook.reduce((best, hour) => (hour.windKnots > best.windKnots ? hour : best));
  const currentHours = outlook.filter((hour) => hour.current !== null);
  const strongest = currentHours.length
    ? currentHours.reduce((best, hour) => (Math.abs(hour.current!) > Math.abs(best.current!) ? hour : best))
    : null;
  const assessed = assessWindow(outlook);

  return {
    available: true,
    label: target.label,
    date: target.date,
    hours: outlook.length,
    windKnots: round(median(outlook.map((hour) => hour.windKnots))),
    windDirection: windiest.direction,
    currentKnots: currentHours.length ? round(median(currentHours.map((hour) => Math.abs(hour.current!))), 2) : null,
    currentPhase: strongest ? (strongest.current! < 0 ? "ebb" : "flood") : null,
    verdict: assessed.verdict,
    opposingWind: assessed.opposingWind,
  };
}
