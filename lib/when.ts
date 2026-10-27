import { addDays, nyParts } from "./time";

export type TargetWindow = {
  label: string;
  date: string; // YYYY-MM-DD (New York)
  startHour: number; // inclusive
  endHour: number; // exclusive
  isNow: boolean;
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// [startHour, endHour, label]
const DAYPARTS: Record<string, [number, number, string]> = {
  morning: [6, 11, "morning"],
  midday: [11, 14, "midday"],
  noon: [11, 14, "midday"],
  afternoon: [12, 17, "afternoon"],
  evening: [17, 20, "evening"],
};


export function resolveWindow(question: string, now: Date = new Date()): TargetWindow {
  const q = question.toLowerCase();
  const ny = nyParts(now);

  let daypart: [number, number, string] | null = null;
  for (const key of Object.keys(DAYPARTS)) {
    if (new RegExp(`\\b${key}\\b`).test(q)) { daypart = DAYPARTS[key]; break; }
  }

  let offset: number | null = null;
  let dayLabel = "";

  if (/\btomorrow\b/.test(q)) {
    offset = 1; dayLabel = "tomorrow";
  } else if (/\btoday\b/.test(q)) {
    offset = 0; dayLabel = "today";
  } else if (/\bweekend\b/.test(q)) {
    const dow = ny.dow; // 0 Sun .. 6 Sat
    offset = dow === 0 ? 0 : 6 - dow; // Sunday -> today (Sun); otherwise days to Saturday
    dayLabel = dow === 0 ? "Sunday" : "Saturday";
  } else {
    for (let i = 0; i < WEEKDAYS.length; i++) {
      if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(q)) {
        let diff = (i - ny.dow + 7) % 7; // 0..6, 0 == today
        if (/\bnext\b/.test(q)) diff += 7;
        offset = diff;
        dayLabel = WEEKDAYS[i][0].toUpperCase() + WEEKDAYS[i].slice(1);
        break;
      }
    }
  }

  // A named daypart or day always wins over "now": otherwise "how's the current this
  // evening?" reads the tidal-current noun as "now" and ignores the evening window.
  // With no daypart and no future day (or a bare "today"), fall back to the rolling 12h.
  const isNow = !daypart && (offset === null || dayLabel === "today");

  if (isNow) {
    return { label: "the next 12 hours", date: ny.date, startHour: ny.hour, endHour: ny.hour, isNow: true };
  }

  const date = addDays(ny.date, offset ?? 0);
  const [startHour, endHour, dpLabel] = daypart ?? [6, 20, ""];
  const dl = dayLabel || "today";
  const label = dpLabel ? `${dl} ${dpLabel}` : dl;

  return { label, date, startHour, endHour, isNow: false };
}
