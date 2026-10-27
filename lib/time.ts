import { getTimes } from "suncalc";
import type { LonLat } from "./zones";

// Everything user-facing is New York wall-clock time, wherever the code runs.
const nyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function nyParts(d: Date) {
  const parts = nyFormat.formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return { date, hour: Number(part("hour")), minute: Number(part("minute")), dow: new Date(`${date}T00:00:00Z`).getUTCDay() };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const nyStamp = (d: Date) => { const p = nyParts(d); return `${p.date} ${pad(p.hour)}:${pad(p.minute)}`; };

// Both NWS ("2026-07-26T06:00:00-04:00") and NOAA ("2026-07-26 06:00") express Eastern
// time, so slice a "YYYY-MM-DD HH" key from the string rather than doing TZ math.
export const hourKey = (ts: string) => ts.slice(0, 13).replace("T", " ");
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Floating wall-clock minutes (no zone): DST gaps/repeats fall at night, which is always no-go.
export const wallMinutes = (stamp: string) => Date.parse(`${stamp.slice(0, 10)}T${stamp.slice(11, 16)}:00Z`) / 60_000;
export const wallStamp = (min: number) => new Date(min * 60_000).toISOString().slice(0, 16).replace("T", " ");

export function sunTimes(date: string, [lon, lat]: LonLat) {
  // Local solar noon in New York is ~17:00 UTC, so this picks the right solar day.
  const t = getTimes(new Date(`${date}T17:00:00Z`), lat, lon);
  return { sunrise: nyStamp(t.sunrise!), sunset: nyStamp(t.sunset!) };
}
