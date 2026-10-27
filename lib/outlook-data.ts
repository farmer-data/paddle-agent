// Server-only: gathers every upstream source for all zones. A failed source nulls only its own field.
import type { OutlookInputs, ZoneInputs } from "./outlook";
import { CONFIG } from "./config";
import { fetchAlerts, fetchCurrentSeries, fetchDischarge, fetchHourlyWind, fetchMarineAlerts, fetchRain48h, fetchWaterTemp, type Alert, type AlertsResult, type CurrentPoint } from "./sources";
import { addDays, nyParts } from "./time";
import { ZONES } from "./zones";

const ok = <T>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

const olderOf = (...stamps: string[]) => stamps.reduce((a, b) => (Date.parse(b) < Date.parse(a) || Number.isNaN(Date.parse(b)) ? b : a));

// Land alerts for the zone plus the shared marine alerts, de-duplicated by alert id. Either part missing means unknown.
function mergeAlerts(point: AlertsResult | null, marine: AlertsResult[] | null): { alerts: Alert[] | null; alertsUpdatedAt: string | null } {
  if (!point || !marine) return { alerts: null, alertsUpdatedAt: null };
  const seen = new Set<string>();
  const alerts: Alert[] = [];
  for (const a of [...point.alerts, ...marine.flatMap((m) => m.alerts)]) {
    const key = a.id ?? `${a.event}|${a.endsAt}`;
    if (!seen.has(key)) { seen.add(key); alerts.push(a); }
  }
  return { alerts, alertsUpdatedAt: olderOf(point.updatedAt, ...marine.map((m) => m.updatedAt)) };
}

export async function getOutlookInputs(now: Date, dates?: string[]): Promise<OutlookInputs> {
  const today = nyParts(now).date;
  const days = dates ?? [today, addDays(today, 1), addDays(today, 2)];

  // The marine zones cover every paddling zone: fetch once and share. None of the zone centres lies inside a marine polygon.
  const marinePromise = Promise.allSettled(CONFIG.marineZones.map((z) => fetchMarineAlerts(z)));

  const [zones, discharge, water, rain] = await Promise.all([
    Promise.all(ZONES.map(async (z): Promise<ZoneInputs> => {
      const [wind, series, alerts, marineSettled] = await Promise.all([
        Promise.allSettled([fetchHourlyWind(z.center)]),
        Promise.allSettled(days.map((d) => fetchCurrentSeries(z.currentStation, d))),
        Promise.allSettled([fetchAlerts(z.center)]),
        marinePromise,
      ]);
      const marine = marineSettled.every((m) => m.status === "fulfilled") ? marineSettled.map((m) => (m as PromiseFulfilledResult<AlertsResult>).value) : null;
      // A partial series would silently leave holes in the hours, so any failed date nulls the whole series.
      const current = series.every((s) => s.status === "fulfilled") ? series.flatMap((s) => (s as PromiseFulfilledResult<CurrentPoint[]>).value) : null;
      return { zoneId: z.id, wind: ok(wind[0]), current, ...mergeAlerts(ok(alerts[0]), marine) };
    })),
    Promise.allSettled([fetchDischarge()]),
    Promise.allSettled([fetchWaterTemp()]),
    Promise.allSettled([fetchRain48h(now)]),
  ]);

  return { generatedAt: now.toISOString(), zones, discharge: ok(discharge[0]), water: ok(water[0]), rain48hIn: ok(rain[0]) };
}
