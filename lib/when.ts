export type TargetWindow = {
  label: string;
  date: string; // YYYY-MM-DD (local)
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

const pad = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

export function resolveWindow(question: string, now: Date = new Date()): TargetWindow {
  const q = question.toLowerCase();

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
    const dow = now.getDay(); // 0 Sun .. 6 Sat
    offset = dow === 0 ? 0 : 6 - dow; // Sunday -> today (Sun); otherwise days to Saturday
    dayLabel = dow === 0 ? "Sunday" : "Saturday";
  } else {
    for (let i = 0; i < WEEKDAYS.length; i++) {
      if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(q)) {
        let diff = (i - now.getDay() + 7) % 7; // 0..6, 0 == today
        if (/\bnext\b/.test(q)) diff += 7;
        offset = diff;
        dayLabel = WEEKDAYS[i][0].toUpperCase() + WEEKDAYS[i].slice(1);
        break;
      }
    }
  }

  const explicitNow = /\b(now|right now|current|currently|at the moment)\b/.test(q);
  const isNow = explicitNow || (offset === null && !daypart) || (dayLabel === "today" && !daypart);

  if (isNow) {
    return { label: "the next 12 hours", date: toDateStr(now), startHour: now.getHours(), endHour: now.getHours(), isNow: true };
  }

  const date = toDateStr(addDays(now, offset ?? 0));
  const [startHour, endHour, dpLabel] = daypart ?? [6, 20, ""];
  const dl = dayLabel || "today";
  const label = dpLabel ? `${dl} ${dpLabel}` : dl;

  return { label, date, startHour, endHour, isNow: false };
}
