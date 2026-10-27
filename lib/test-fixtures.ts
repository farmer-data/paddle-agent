import { addDays, nyStamp, nyWallToDate, wallMinutes } from "./time";
import { ZONES } from "./zones";
import type { OutlookInputs } from "./outlook";

export const NOW = new Date("2026-10-26T16:00:00Z"); // 12:00 NY, sunset ≈ 17:5x

const offsetOf = (d: Date) => {
  const min = wallMinutes(nyStamp(d)) - d.getTime() / 60_000;
  return `${min < 0 ? "-" : "+"}${String(Math.abs(min) / 60).padStart(2, "0")}:00`;
};

// Three NY days from `from` for every zone: 5 kn wind from S, +0.6 kn current toward 11°,
// fresh discharge and water temperature (stamped at NOW), no rain, no alerts.
export function inputs(overrides: { from?: string; windUpdatedAt?: string; forecastUpdateTime?: string; alertsUpdatedAt?: string } = {}): OutlookInputs {
  const from = overrides.from ?? "2026-10-26";
  const instants: Date[] = [];
  for (let t = nyWallToDate(from, 0).getTime(); t < nyWallToDate(addDays(from, 3), 0).getTime(); t += 3_600_000) instants.push(new Date(t));
  const periods = instants.map((d) => ({ ts: `${nyStamp(d).slice(0, 10)}T${nyStamp(d).slice(11, 13)}:00:00${offsetOf(d)}`, windKnots: 5, fromDeg: 180, direction: "S" }));
  const current = instants.map((d) => ({ ts: `${nyStamp(d).slice(0, 13)}:00`, signed: 0.6, towardDeg: 11 }));
  return {
    generatedAt: NOW.toISOString(),
    zones: ZONES.map((z) => ({ zoneId: z.id, wind: { periods, updatedAt: overrides.windUpdatedAt ?? "2026-10-26T15:00:00Z", updateTime: overrides.forecastUpdateTime ?? "2026-10-26T13:00:00Z" }, current, alerts: [], alertsUpdatedAt: overrides.alertsUpdatedAt ?? NOW.toISOString() })),
    discharge: { cfs: 5000, at: NOW.toISOString() },
    water: { f: 61, at: nyStamp(NOW) },
    rain48hIn: 0,
  };
}
