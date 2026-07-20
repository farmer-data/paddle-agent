# Forecast-aware Paddle Agent (web card) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web reply card answer future-facing questions ("Can I paddle Sunday morning?") by re-anchoring its verdict, stats, and chart to the requested day/time using real NWS hourly wind + NOAA tidal-current predictions, while the live hero stays on "now".

**Architecture:** A deterministic resolver turns the question into a target window. The chat route fetches all NWS hourly wind (~156 hrs) plus NOAA hourly current predictions for the target date, joins them by local-hour, assesses each hour with its own wind + current, and derives a window verdict from the best workable sub-window. The route returns a new `forecast` object that drives the card; the existing `briefing` (now snapshot) still drives the hero/gauges untouched.

**Tech Stack:** TypeScript, Next.js 16 (App Router, `nodejs` runtime), Vercel AI SDK (`generateObject`, gpt-5-mini), Recharts, Vitest (new, for tests).

## Global Constraints

- Runtime for the route stays `export const runtime = "nodejs";`.
- Path alias: `@/*` → repo root (see `tsconfig.json`). Tests must resolve it (Vitest config below).
- No new external services or ingestion; forecasts are fetched live per request via `fetch`.
- NOAA station for current is `NYH1927` ("Hudson River Entrance"). NWS grid point stays `40.7076,-74.0253`.
- Daypart hours (start inclusive, end exclusive): morning `6–11`, midday `11–14`, afternoon `12–17`, evening `17–20`; bare day → `6–20`.
- Wind/current hour-join key is a local-hour string `"YYYY-MM-DD HH"` derived by string-slicing (both sources express Eastern time), never by TZ math.
- `git commit` after each task. Do not touch `trigger/chat.ts` or add discharge forecasting (out of scope).

---

### Task 1: Add Vitest tooling

**Files:**
- Modify: `package.json` (add devDependency + `test` script)
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `npm test` command running Vitest with the `@` alias resolved; later tasks rely on it.

- [ ] **Step 1: Install Vitest**

Run:
```bash
npm install -D vitest
```
Expected: adds `vitest` to `devDependencies`, exits 0.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { environment: "node" },
});
```

- [ ] **Step 3: Add the `test` script to `package.json`**

In the `"scripts"` block, add:
```json
"test": "vitest run",
```

- [ ] **Step 4: Add a temporary smoke test and verify the runner works**

Create `lib/smoke.test.ts`:
```ts
import { expect, test } from "vitest";

test("vitest runs", () => {
  expect(1 + 1).toBe(2);
});
```
Run: `npm test`
Expected: PASS, 1 test passed.

- [ ] **Step 5: Delete the smoke test**

Run: `rm lib/smoke.test.ts`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "Add Vitest test runner with @ alias"
```

---

### Task 2: Deterministic time resolver (`lib/when.ts`)

**Files:**
- Create: `lib/when.ts`
- Test: `lib/when.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type TargetWindow = { label: string; date: string; startHour: number; endHour: number; isNow: boolean };
  export function resolveWindow(question: string, now?: Date): TargetWindow;
  ```
  `date` is local `YYYY-MM-DD`; `startHour` inclusive, `endHour` exclusive; `isNow` true means "rolling next 12 hours from now".

- [ ] **Step 1: Write the failing test**

Create `lib/when.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolveWindow } from "./when";

// 2026-07-21 is a Tuesday.
const TUE_9AM = new Date(2026, 6, 21, 9, 0);

describe("resolveWindow", () => {
  it("resolves 'Sunday morning' to the coming Sunday, 6-11", () => {
    const w = resolveWindow("Can I paddle Sunday morning with a beginner?", TUE_9AM);
    expect(w).toMatchObject({ date: "2026-07-26", startHour: 6, endHour: 11, isNow: false, label: "Sunday morning" });
  });

  it("resolves 'tomorrow afternoon'", () => {
    const w = resolveWindow("what about tomorrow afternoon?", TUE_9AM);
    expect(w).toMatchObject({ date: "2026-07-22", startHour: 12, endHour: 17, isNow: false, label: "tomorrow afternoon" });
  });

  it("resolves 'next Monday' to +7 days past the coming Monday", () => {
    const w = resolveWindow("how's next Monday looking", TUE_9AM);
    // coming Monday is 2026-07-27 (+6); "next" adds 7 => 2026-08-03
    expect(w).toMatchObject({ date: "2026-08-03", isNow: false });
  });

  it("resolves a bare weekday to the full day window 6-20", () => {
    const w = resolveWindow("saturday?", TUE_9AM);
    expect(w).toMatchObject({ date: "2026-07-25", startHour: 6, endHour: 20, label: "Saturday", isNow: false });
  });

  it("resolves 'this weekend' to the coming Saturday", () => {
    const w = resolveWindow("thinking about this weekend", TUE_9AM);
    expect(w).toMatchObject({ date: "2026-07-25", label: "Saturday", isNow: false });
  });

  it("treats 'current conditions' as now", () => {
    expect(resolveWindow("Show current Hudson conditions", TUE_9AM).isNow).toBe(true);
  });

  it("treats a question with no time words as now", () => {
    expect(resolveWindow("Find low-wind paddle windows", TUE_9AM).isNow).toBe(true);
  });

  it("treats bare 'today' as now (rolling 12h)", () => {
    expect(resolveWindow("can I go out today", TUE_9AM).isNow).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- when`
Expected: FAIL — cannot find module `./when`.

- [ ] **Step 3: Implement `lib/when.ts`**

```ts
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
    if (q.includes(key)) { daypart = DAYPARTS[key]; break; }
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- when`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/when.ts lib/when.test.ts
git commit -m "Add deterministic time-window resolver"
```

---

### Task 3: NOAA current-prediction fetcher (`lib/sources.ts`)

**Files:**
- Modify: `lib/sources.ts` (append new type + function)
- Test: `lib/sources.test.ts`

**Interfaces:**
- Consumes: the module-level `NOAA` datagetter URL constant already in `lib/sources.ts`.
- Produces:
  ```ts
  export type CurrentPrediction = { ts: string; knots: number; direction: "ebb" | "flood" };
  export function fetchCurrentPredictions(date: string /* YYYY-MM-DD */): Promise<CurrentPrediction[]>;
  ```
  `ts` is NOAA local `"YYYY-MM-DD HH:MM"`; `knots` is the absolute velocity; negative `Velocity_Major` → `"ebb"`, otherwise `"flood"`.

- [ ] **Step 1: Write the failing test**

Create `lib/sources.test.ts`:
```ts
import { afterEach, expect, it, vi } from "vitest";
import { fetchCurrentPredictions } from "./sources";

afterEach(() => vi.restoreAllMocks());

it("maps signed Velocity_Major to ebb/flood magnitude", async () => {
  const payload = {
    current_predictions: {
      cp: [
        { Time: "2026-07-26 07:00", Velocity_Major: 0.48, Bin: "13" },
        { Time: "2026-07-26 11:00", Velocity_Major: -0.91, Bin: "13" },
        { Time: "2026-07-26 04:00", Velocity_Major: 0, Bin: "13" },
      ],
    },
  };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

  const rows = await fetchCurrentPredictions("2026-07-26");

  expect(rows).toEqual([
    { ts: "2026-07-26 07:00", knots: 0.48, direction: "flood" },
    { ts: "2026-07-26 11:00", knots: 0.91, direction: "ebb" },
    { ts: "2026-07-26 04:00", knots: 0, direction: "flood" },
  ]);
});

it("requests the NYH1927 station with a compact date range and interval=60", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ current_predictions: { cp: [] } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await fetchCurrentPredictions("2026-07-26");

  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain("product=currents_predictions");
  expect(url).toContain("station=NYH1927");
  expect(url).toContain("begin_date=20260726");
  expect(url).toContain("end_date=20260726");
  expect(url).toContain("interval=60");
});

it("returns [] when the payload has no cp array", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 200 })));
  expect(await fetchCurrentPredictions("2026-07-26")).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- sources`
Expected: FAIL — `fetchCurrentPredictions` is not exported.

- [ ] **Step 3: Append the implementation to `lib/sources.ts`**

Add at the end of the file:
```ts
export type CurrentPrediction = { ts: string; knots: number; direction: "ebb" | "flood" };

export async function fetchCurrentPredictions(date: string): Promise<CurrentPrediction[]> {
  const compact = date.replaceAll("-", "");
  const url = new URL(NOAA);
  url.search = new URLSearchParams({
    product: "currents_predictions",
    station: "NYH1927",
    begin_date: compact,
    end_date: compact,
    time_zone: "lst_ldt",
    units: "english",
    interval: "60",
    format: "json",
    application: "kayak-guide",
  }).toString();
  const json = await fetch(url).then((r) => r.json());
  const items: any[] = json.current_predictions?.cp ?? [];
  return items.map((item) => {
    const velocity = Number(item.Velocity_Major);
    return { ts: item.Time, knots: Math.abs(velocity), direction: velocity < 0 ? "ebb" : "flood" };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- sources`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/sources.ts lib/sources.test.ts
git commit -m "Add NOAA tidal-current prediction fetcher"
```

---

### Task 4: Window-aware outlook + verdict (`lib/windows.ts`)

**Files:**
- Modify: `lib/windows.ts` (change `HourlyRisk`, rewrite `buildHourlyOutlook`, add `assessWindow`; keep `findBestWindow`)
- Test: `lib/windows.test.ts`

**Interfaces:**
- Consumes: `assessSafety`/`Risk` from `./safety`; `TargetWindow` from `./when`; `CurrentPrediction` from `./sources`; existing `findBestWindow`.
- Produces:
  ```ts
  export type HourlyRisk = { ts: string; hourLabel: string; windKnots: number; direction: string; risk: Risk; opposing: boolean };
  export function buildHourlyOutlook(
    wind: { ts: string; windKnots: number; direction: string }[],
    current: CurrentPrediction[],
    base: { dischargeCfs?: number },
    target: TargetWindow,
  ): HourlyRisk[];
  export function assessWindow(hourly: HourlyRisk[]): { verdict: Risk; best: PaddleWindow | null; opposingWind: boolean };
  ```
  For `target.isNow`, `buildHourlyOutlook` returns the first 12 wind periods (rolling from now); otherwise it returns wind periods whose local date equals `target.date` and whose hour is in `[startHour, endHour)`. Each hour is assessed with its own wind and the current for that same local-hour (missing current → treated as undefined/`ebb`).

- [ ] **Step 1: Write the failing test**

Create `lib/windows.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { CurrentPrediction } from "./sources";
import { assessWindow, buildHourlyOutlook, type HourlyRisk } from "./windows";
import { resolveWindow } from "./when";

const TUE_9AM = new Date(2026, 6, 21, 9, 0);

// Wind periods spanning today + the coming Sunday; ISO with Eastern offset.
const wind = [
  { ts: "2026-07-21T09:00:00-04:00", windKnots: 5, direction: "S" },
  { ts: "2026-07-21T10:00:00-04:00", windKnots: 6, direction: "S" },
  { ts: "2026-07-26T06:00:00-04:00", windKnots: 4, direction: "N" },
  { ts: "2026-07-26T07:00:00-04:00", windKnots: 5, direction: "N" },
  { ts: "2026-07-26T08:00:00-04:00", windKnots: 20, direction: "S" }, // strong opposing
  { ts: "2026-07-26T09:00:00-04:00", windKnots: 5, direction: "N" },
  { ts: "2026-07-26T10:00:00-04:00", windKnots: 5, direction: "N" },
  { ts: "2026-07-26T12:00:00-04:00", windKnots: 5, direction: "N" }, // outside morning
];
const current: CurrentPrediction[] = [
  { ts: "2026-07-26 08:00", knots: 2, direction: "ebb" }, // ebb + S wind = opposing
];

describe("buildHourlyOutlook", () => {
  it("filters to the target date + daypart hours", () => {
    const target = resolveWindow("Sunday morning?", TUE_9AM);
    const outlook = buildHourlyOutlook(wind, current, {}, target);
    expect(outlook.map((h) => h.ts.slice(0, 13))).toEqual([
      "2026-07-26T06", "2026-07-26T07", "2026-07-26T08", "2026-07-26T09", "2026-07-26T10",
    ]);
  });

  it("flags the opposing-wind hour as danger", () => {
    const target = resolveWindow("Sunday morning?", TUE_9AM);
    const outlook = buildHourlyOutlook(wind, current, {}, target);
    const eight = outlook.find((h) => h.ts.includes("T08"))!;
    expect(eight.opposing).toBe(true);
    expect(eight.risk).toBe("danger");
  });

  it("takes the first 12 rolling periods when isNow", () => {
    const target = resolveWindow("current conditions", TUE_9AM);
    const outlook = buildHourlyOutlook(wind, current, {}, target);
    expect(outlook.length).toBe(Math.min(12, wind.length));
    expect(outlook[0].ts).toBe("2026-07-21T09:00:00-04:00");
  });
});

describe("assessWindow", () => {
  it("returns the best >=2h safe sub-window and a safe verdict", () => {
    const hourly: HourlyRisk[] = [
      { ts: "a", hourLabel: "9 AM", windKnots: 5, direction: "N", risk: "safe", opposing: false },
      { ts: "b", hourLabel: "10 AM", windKnots: 5, direction: "N", risk: "safe", opposing: false },
      { ts: "c", hourLabel: "11 AM", windKnots: 20, direction: "S", risk: "danger", opposing: true },
    ];
    const out = assessWindow(hourly);
    expect(out.verdict).toBe("safe");
    expect(out.best).toMatchObject({ startIndex: 0, endIndex: 1, risk: "safe" });
    expect(out.opposingWind).toBe(false);
  });

  it("returns danger verdict when no >=2h non-danger window exists", () => {
    const hourly: HourlyRisk[] = [
      { ts: "a", hourLabel: "9 AM", windKnots: 20, direction: "S", risk: "danger", opposing: true },
      { ts: "b", hourLabel: "10 AM", windKnots: 5, direction: "N", risk: "safe", opposing: false },
      { ts: "c", hourLabel: "11 AM", windKnots: 20, direction: "S", risk: "danger", opposing: true },
    ];
    const out = assessWindow(hourly);
    expect(out.verdict).toBe("danger");
    expect(out.best).toBeNull();
    expect(out.opposingWind).toBe(true); // no best window -> evaluate all hours
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- windows`
Expected: FAIL — `assessWindow` not exported / `buildHourlyOutlook` signature mismatch.

- [ ] **Step 3: Rewrite `lib/windows.ts`**

Replace the entire file with:
```ts
import type { CurrentPrediction } from "./sources";
import { assessSafety, type Risk } from "./safety";
import type { TargetWindow } from "./when";

export type HourlyRisk = { ts: string; hourLabel: string; windKnots: number; direction: string; risk: Risk; opposing: boolean };
export type PaddleWindow = { startLabel: string; endLabel: string; startIndex: number; endIndex: number; risk: Risk };

const rank: Record<Risk, number> = { safe: 0, caution: 1, danger: 2 };
const directionDegrees: Record<string, number> = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };

// Both NWS ("2026-07-26T06:00:00-04:00") and NOAA ("2026-07-26 06:00") express Eastern
// time, so slice a "YYYY-MM-DD HH" key from the string rather than doing TZ math.
const hourKey = (ts: string) => ts.slice(0, 13).replace("T", " ");
const dateOf = (ts: string) => ts.slice(0, 10);
const hourOf = (ts: string) => Number(ts.slice(11, 13));
const labelForHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

export function buildHourlyOutlook(
  wind: { ts: string; windKnots: number; direction: string }[],
  current: CurrentPrediction[],
  base: { dischargeCfs?: number },
  target: TargetWindow,
): HourlyRisk[] {
  const currentByHour = new Map(current.map((c) => [hourKey(c.ts), c]));
  const selected = target.isNow
    ? wind.slice(0, 12)
    : wind.filter((w) => dateOf(w.ts) === target.date && hourOf(w.ts) >= target.startHour && hourOf(w.ts) < target.endHour);

  return selected.map((period) => {
    const cur = currentByHour.get(hourKey(period.ts));
    const assessment = assessSafety({
      dischargeCfs: base.dischargeCfs,
      currentKnots: cur?.knots,
      windKnots: period.windKnots,
      windDirection: directionDegrees[period.direction],
      currentDirection: cur?.direction ?? "ebb",
    });
    return {
      ts: period.ts,
      hourLabel: labelForHour(hourOf(period.ts)),
      windKnots: period.windKnots,
      direction: period.direction,
      risk: assessment.verdict,
      opposing: assessment.opposingWind,
    };
  });
}

// Longest stretch of all-safe hours; if none, longest stretch avoiding danger.
export function findBestWindow(outlook: HourlyRisk[]): PaddleWindow | null {
  for (const ceiling of [rank.safe, rank.caution]) {
    let best: [number, number] | null = null;
    let start = -1;
    for (let i = 0; i <= outlook.length; i++) {
      if (i < outlook.length && rank[outlook[i].risk] <= ceiling) {
        if (start === -1) start = i;
      } else if (start !== -1) {
        if (!best || i - start > best[1] - best[0]) best = [start, i - 1];
        start = -1;
      }
    }
    if (best && best[1] > best[0]) {
      const [from, to] = best;
      return {
        startLabel: outlook[from].hourLabel,
        endLabel: outlook[to].hourLabel,
        startIndex: from,
        endIndex: to,
        risk: ceiling === rank.safe ? "safe" : "caution",
      };
    }
  }
  return null;
}

export function assessWindow(hourly: HourlyRisk[]): { verdict: Risk; best: PaddleWindow | null; opposingWind: boolean } {
  const best = findBestWindow(hourly);
  const verdict: Risk = best ? best.risk : "danger";
  const scope = best ? hourly.slice(best.startIndex, best.endIndex + 1) : hourly;
  const opposingWind = scope.some((h) => h.opposing);
  return { verdict, best, opposingWind };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- windows`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass; `tsc --noEmit` reports no errors. (If `typecheck` flags the old `buildHourlyOutlook` call in `app/api/chat/route.ts`, that is expected — Task 5 fixes it. Note it and continue.)

- [ ] **Step 6: Commit**

```bash
git add lib/windows.ts lib/windows.test.ts
git commit -m "Make hourly outlook window-aware and add window verdict"
```

---

### Task 5: Wire the forecast into the chat route (`app/api/chat/route.ts`)

**Files:**
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: `resolveWindow` (Task 2), `fetchCurrentPredictions`/`CurrentPrediction` (Task 3), `buildHourlyOutlook`/`assessWindow`/`HourlyRisk`/`PaddleWindow` (Task 4), existing `fetchNwsHourlyWind`, `latestConditions`, `buildQuickBriefing`, `buildFastAnswer`.
- Produces: JSON response with a new `forecast` field:
  ```ts
  forecast: { label: string; isNow: boolean; verdict: Risk | null; opposingWind: boolean; best: PaddleWindow | null } | null
  ```
  `briefing`, `readings`, `card`, `text`, `hourly`, `window` keep their meanings; `hourly`/`window` now reflect the target window. `verdict` is `null` only when the target is beyond the ~7-day wind horizon.

- [ ] **Step 1: Update imports**

At the top of `app/api/chat/route.ts`, replace the sources/windows imports with the following (note the added `Risk` import — the route annotates `forecast.verdict` as `Risk | null` and does not currently import it):
```ts
import { fetchNwsHourlyWind, fetchCurrentPredictions, type CurrentPrediction } from "@/lib/sources";
import { buildHourlyOutlook, assessWindow, type HourlyRisk, type PaddleWindow } from "@/lib/windows";
import { resolveWindow } from "@/lib/when";
import type { Risk } from "@/lib/safety";
```

- [ ] **Step 2: Replace the forecast-building block**

Find the block that starts `let hourly: HourlyRisk[] = [];` and ends just before `const windowNote = ...`. Replace from `let hourly` through the end of the `hourlyDigest`/`hccbNote` assignments with:
```ts
    const target = resolveWindow(message);
    let hourly: HourlyRisk[] = [];
    let window: PaddleWindow | null = null;
    let forecast: { label: string; isNow: boolean; verdict: Risk | null; opposingWind: boolean; best: PaddleWindow | null } | null = null;
    let beyondHorizon = false;
    try {
      const [wind, current] = await Promise.all([
        fetchNwsHourlyWind(),
        fetchCurrentPredictions(target.date).catch(() => [] as CurrentPrediction[]),
      ]);
      hourly = buildHourlyOutlook(wind, current, { dischargeCfs: values.discharge }, target);
      beyondHorizon = !target.isNow && wind.length > 0 && hourly.length === 0;
      const assessed = assessWindow(hourly);
      window = assessed.best;
      forecast = {
        label: target.label,
        isNow: target.isNow,
        verdict: beyondHorizon ? null : assessed.verdict,
        opposingWind: assessed.opposingWind,
        best: assessed.best,
      };
    } catch {
      // Forecast is best-effort; the reply still works from the snapshot alone.
    }

    const windowNote = beyondHorizon
      ? `${target.label} is beyond the ~7-day forecast horizon — say you cannot see that far out and do not give a go/no-go verdict.`
      : window
        ? `Best paddle window for ${target.label}: ${window.startLabel}–${window.endLabel} (${window.risk === "safe" ? "green" : "caution"}).`
        : `No clear multi-hour window for ${target.label}.`;
    const hourlyDigest = hourly.length
      ? `Hourly wind+current outlook for ${target.label}: ${hourly.map((h) => `${h.hourLabel} ${h.windKnots}kt/${h.risk}${h.opposing ? "/opposing" : ""}`).join(", ")}.`
      : "No hourly forecast available for that window.";
    const dischargeNote = `\nRiver discharge is assumed steady from the latest reading (${values.discharge === undefined ? "n/a" : `${Math.round(values.discharge)} cfs`}); it is not forecast.`;
    const hccbNote = (forecast?.verdict ?? briefing.assessment.verdict) === "safe"
      ? "\nThe verdict is GO, so the action should be Hoboken Cove Community Boathouse's free paddle days (hccb: true)."
      : "";
```

- [ ] **Step 3: Include the window in the model prompt**

In the `generateObject` call, change the `prompt` field to append `windowNote`, `hourlyDigest`, and `dischargeNote` for the resolved target. Replace the existing `prompt:` line with:
```ts
        prompt: `Paddler question: ${message}\nTarget window: ${target.label}\n\nLatest readings (${briefing.updatedAt}):\n${JSON.stringify(readings)}\nSafety assessment (now): ${JSON.stringify(briefing.assessment)}\nForecast verdict for ${target.label}: ${forecast?.verdict ?? "unknown"}\n${windowNote}\n${hourlyDigest}${dischargeNote}${hccbNote}`,
```
Also update the `system` string's launch-time guidance sentence to read: `Use the hourly trend for the requested window to pick the launch time — name when the wind turns; when the question names a future day, speak to that day, not to right now.`

- [ ] **Step 4: Return `forecast` on both response paths**

In the success `Response.json({ ... })`, add `forecast`:
```ts
      return Response.json({ card: safeCard, text: null, readings, briefing, hourly, window, forecast });
```
In the `catch` fallback `Response.json({ ... })`, add `forecast`:
```ts
      return Response.json({ card: null, text: buildFastAnswer(message, readings), readings, briefing, hourly, window, forecast });
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Drive the running dev server**

The dev server runs at `http://localhost:3000` (restart with `npm run dev` if needed). Run:
```bash
curl -s -X POST http://localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"message":"Can I paddle Sunday morning with a beginner?"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('forecast:', d.get('forecast')); print('hourly hours:', [h['hourLabel'] for h in (d.get('hourly') or [])])"
```
Expected: `forecast.label` is `"Sunday morning"`, `isNow` is `false`, `verdict` is one of safe/caution/danger, and `hourly` hours fall in the 6–10 AM range for the coming Sunday (not the next 12 rolling hours).

Also confirm a "now" question is unchanged:
```bash
curl -s -X POST http://localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"message":"Show current Hudson conditions"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('isNow:', d['forecast']['isNow'], 'hours:', len(d.get('hourly') or []))"
```
Expected: `isNow: True`, up to 12 hours.

- [ ] **Step 7: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "Re-anchor chat route to the requested forecast window"
```

---

### Task 6: Re-anchor the card UI (`app/components/kayak-chat.tsx`)

**Files:**
- Modify: `app/components/kayak-chat.tsx`

**Interfaces:**
- Consumes: the route's `forecast` field (Task 5).
- Produces: the reply card verdict + chart title reflect the target window; the top hero and gauges remain driven by the live `briefing`.

- [ ] **Step 1: Extend the `Message` type and add a `Forecast` type**

Near the existing `type Message = ...`, add:
```ts
type Forecast = { label: string; isNow: boolean; verdict: Risk | null; opposingWind: boolean };
```
Change `Message` to allow a null verdict and carry the forecast:
```ts
type Message = { role: "user" | "assistant"; text: string; pending?: boolean; card?: ReplyCard | null; verdict?: Risk | null; hourly?: HourlyRisk[]; window?: PaddleWindow | null; forecast?: Forecast | null };
```

- [ ] **Step 2: Give `PaddleTimeline` an optional title**

Change the `PaddleTimeline` signature and its `<h4>`:
```tsx
function PaddleTimeline({ hourly, window, title }: { hourly: HourlyRisk[]; window?: PaddleWindow | null; title?: string }) {
```
```tsx
        <h4>{title ? `${title} · wind` : `Next ${hourly.length} hours · wind`}</h4>
```

- [ ] **Step 3: Thread the title through `CardReply` and `AssistantReply`**

In `CardReply`, add `windowLabel` to its props and pass it to the timeline:
```tsx
function CardReply({ card, verdict, hourly, window, windowLabel, onAsk }: { card: ReplyCard; verdict?: Risk | null; hourly?: HourlyRisk[]; window?: PaddleWindow | null; windowLabel?: string; onAsk: (q: string) => void }) {
```
```tsx
        {hourly && hourly.length > 0 && <PaddleTimeline hourly={hourly} window={window} title={windowLabel} />}
```
In `AssistantReply`, add `windowLabel` similarly:
```tsx
function AssistantReply({ text, pending, hourly, window, windowLabel }: { text: string; pending?: boolean; hourly?: HourlyRisk[]; window?: PaddleWindow | null; windowLabel?: string }) {
```
```tsx
        {hourly && hourly.length > 0 && <PaddleTimeline hourly={hourly} window={window} title={windowLabel} />}
```

- [ ] **Step 4: Populate the message from `forecast` in `ask`**

In `ask`, replace the success `setMessages(...)` mapping's assistant object with:
```tsx
setMessages((old) => old.map((item, index) => index === old.length - 1 ? { role: "assistant", text: data.text ?? "", card: data.card, verdict: data.forecast ? data.forecast.verdict : (data.briefing?.assessment?.verdict ?? null), hourly: data.hourly, window: data.window, forecast: data.forecast } : item));
```
Keep the existing `setReadings(data.readings); setBriefing(data.briefing);` line unchanged so the hero stays "now".

- [ ] **Step 5: Pass `windowLabel` where the replies are rendered**

In the `messages.map(...)` render, compute the label (only for non-now windows) and pass it:
```tsx
{message.role === "user"
  ? <p>{message.text}</p>
  : message.card
    ? <CardReply card={message.card} verdict={message.verdict} hourly={message.hourly} window={message.window} windowLabel={message.forecast && !message.forecast.isNow ? message.forecast.label : undefined} onAsk={ask} />
    : <AssistantReply text={message.text} pending={message.pending} hourly={message.hourly} window={message.window} windowLabel={message.forecast && !message.forecast.isNow ? message.forecast.label : undefined} />}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 7: Verify in the browser**

With the dev server running, load `http://localhost:3000`, click the "Can I paddle Sunday morning with a beginner?" prompt, and confirm:
- the reply card's chart header reads "Sunday morning · wind" (not "Next 12 hours");
- the card verdict chip reflects Sunday's window;
- the top hero verdict + gauges still show live "now" conditions (unchanged).

Take a screenshot to confirm the card renders (not a blank frame).

- [ ] **Step 8: Commit**

```bash
git add app/components/kayak-chat.tsx
git commit -m "Re-anchor reply card and chart to the forecast window"
```

---

## Self-Review Notes

- **Spec coverage:** `lib/when.ts` (Task 2) = resolver; `fetchCurrentPredictions` (Task 3) = NOAA current; `buildHourlyOutlook`/`assessWindow` (Task 4) = per-hour join + window verdict + opposing-wind; route `forecast` field + prompt + horizon/steady-discharge handling (Task 5); card verdict + chart title + preserved hero (Task 6). Beyond-horizon and NOAA-failure fallbacks are in Task 5. Unit + composition tests are in Tasks 2–4; route + UI are driven live (Tasks 5–6) since a full HTTP test would require mocking the OpenAI/ClickHouse layer for low marginal value.
- **Type consistency:** `TargetWindow`, `CurrentPrediction`, `HourlyRisk` (now includes `opposing`), `PaddleWindow`, and `forecast: { label, isNow, verdict: Risk | null, opposingWind, best }` are used identically across tasks. `verdict` is `Risk | null` everywhere it crosses the route→UI boundary.
- **No placeholders:** every code step contains complete code; commands include expected output.
