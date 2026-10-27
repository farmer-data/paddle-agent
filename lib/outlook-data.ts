// Server-only: gathers every upstream source for all zones. A failed source nulls only its own field.
import type { OutlookInputs, ZoneInputs } from "./outlook";
import { fetchAlerts, fetchCurrentSeries, fetchDischarge, fetchHourlyWind, fetchRain48h, fetchWaterTemp, type CurrentPoint } from "./sources";
import { addDays, nyParts } from "./time";
import { ZONES } from "./zones";

const ok = <T>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

export async function getOutlookInputs(now: Date, dates?: string[]): Promise<OutlookInputs> {
  const today = nyParts(now).date;
  const days = dates ?? [today, addDays(today, 1), addDays(today, 2)];

  const [zones, discharge, water, rain] = await Promise.all([
    Promise.all(ZONES.map(async (z): Promise<ZoneInputs> => {
      const [wind, series, alerts] = await Promise.all([
        Promise.allSettled([fetchHourlyWind(z.center)]),
        Promise.allSettled(days.map((d) => fetchCurrentSeries(z.currentStation, d))),
        Promise.allSettled([fetchAlerts(z.center)]),
      ]);
      // A partial series would silently leave holes in the hours, so any failed date nulls the whole series.
      const current = series.every((s) => s.status === "fulfilled") ? series.flatMap((s) => (s as PromiseFulfilledResult<CurrentPoint[]>).value) : null;
      return { zoneId: z.id, wind: ok(wind[0]), current, alerts: ok(alerts[0]) };
    })),
    Promise.allSettled([fetchDischarge()]),
    Promise.allSettled([fetchWaterTemp()]),
    Promise.allSettled([fetchRain48h(now)]),
  ]);

  return { generatedAt: now.toISOString(), zones, discharge: ok(discharge[0]), water: ok(water[0]), rain48hIn: ok(rain[0]) };
}
