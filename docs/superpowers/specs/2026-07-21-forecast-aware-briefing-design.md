# Forecast-aware Paddle Agent (web card) — Design

**Date:** 2026-07-21
**Status:** Approved, ready for implementation plan
**Scope:** `app/api/chat/route.ts` (web briefing card) + shared `lib` functions. Out of scope: `trigger/chat.ts`, discharge forecasting, persisting forecasts to ClickHouse.

## Problem

The web chat answers every question from `latestConditions()` — the single most recent reading in ClickHouse, i.e. **right now**. A question like "Can I paddle Sunday morning with a beginner?" still gets judged on this minute's wind. The "NEXT 12 HOURS" chart uses a live NWS forecast but is sliced to 12 rolling hours from now and paired with *today's* discharge/current, so it never reflects a requested future day.

## Goal

When a question targets a future day/time, re-anchor the reply **card** (verdict, stats, chart, best-window) to that window using real forecasts:

- **Wind** — NWS `forecastHourly` already returns ~156 hourly periods (~6.5 days); we currently discard all but 12.
- **Tidal current** — NOAA `currents_predictions` (harmonic) gives hourly signed velocity for any future date.
- **Discharge** — not forecast (per agreed scope); held at the latest reading with an explicit "assumed steady" caveat.

The live "verdict hero" and gauges at the top of the page must keep showing **now** — they are driven by the snapshot and must not be overwritten with a future verdict.

## Units

### 1. `lib/when.ts` (new) — deterministic time resolver

```ts
type TargetWindow = { label: string; date: string /* YYYY-MM-DD */; startHour: number; endHour: number; isNow: boolean };
function resolveWindow(question: string, now?: Date): TargetWindow;
```

- Parses: weekday names with optional `next` prefix; `today` / `tomorrow`; `this weekend` → the **upcoming Saturday** (single day, to keep the hourly chart coherent); dayparts — morning `6–11`, midday `11–14`, afternoon `12–17`, evening `17–20`; a bare day with no daypart → `6–20`.
- No temporal phrase, or `now` / `current` / `right now` → `{ isNow: true }` with a rolling next-12h window (preserves today's behavior).
- Unparseable temporal intent → same `isNow` fallback; the reply notes it defaulted to now.
- Pure functions, unit-tested. `label` is human-facing, e.g. `"Sunday morning"`, `"tomorrow afternoon"`, `"the next 12 hours"`.

### 2. `lib/sources.ts` — add tidal current forecast

```ts
function fetchCurrentPredictions(date: string /* YYYY-MM-DD */):
  Promise<{ ts: string; knots: number; direction: "ebb" | "flood" }[]>;
```

- NOAA `currents_predictions`, station **`NYH1927`** ("Hudson River Entrance", 40.7076 / -74.0253 — the exact point already used for the NWS wind grid), `interval=60`, `begin_date`/`end_date` = `date` (compact `YYYYMMDD`), `time_zone=lst_ldt`, `units=english`.
- Response rows carry signed `Velocity_Major`: **negative → ebb** (meanEbbDir ≈ 183°, ~south), **positive → flood** (meanFloodDir ≈ 11°, ~north). Map `direction` from the sign and `knots = Math.abs(Velocity_Major)`.
- `fetchNwsHourlyWind()` already returns all ~156 hours — no change to the function; callers stop slicing to 12.

### 3. `lib/windows.ts` — window-aware outlook + verdict

- `buildHourlyOutlook(wind, current, { dischargeCfs }, target)` — join wind and current **by hour** — NWS timestamps are ISO with offset (`2026-07-26T06:00:00-04:00`) and NOAA are local `"YYYY-MM-DD HH:MM"`; normalize both to a `YYYY-MM-DD HH` local-hour key for the join — filter to `target` (date + `startHour..endHour`), and assess each hour with *its own* wind **and** current. This is what makes opposing-wind-vs-ebb correct for a future time. If current predictions are missing for an hour, fall back to a steady current value.
- `assessWindow(hourly) → { verdict: Risk; best: PaddleWindow | null; opposingWind: boolean }` — verdict derives from the best ≥2h sub-window found by the existing `findBestWindow` (`safe`/`caution`), or `danger` when no such window exists. `opposingWind` = any hour within `best` (or the window, if no `best`) has wind opposing the current.
- `findBestWindow` reused unchanged.

### 4. `app/api/chat/route.ts`

- `const target = resolveWindow(message);`
- Fetch NWS wind (all hours) + `fetchCurrentPredictions(target.date)` (for `isNow`, fetch **today's** predictions — the small bonus so even the rolling 12h chart gets real per-hour current).
- `const hourly = buildHourlyOutlook(wind, current, { dischargeCfs: latest.discharge }, target);`
- `const forecast = assessWindow(hourly);`
- Response shape:
  - `briefing` — **unchanged NOW snapshot** (drives the live hero + gauges).
  - `forecast: { label, isNow, verdict, opposingWind, best }` — the target-window assessment; drives the card verdict. (No per-factor gauges here — those render only in the live hero from the NOW snapshot.)
  - `hourly` — the re-anchored target-window hours.
  - `window` — `forecast.best` (best sub-window), indices into `hourly` (existing `PaddleWindow` shape).
  - `card`, `text`, `readings` — as today.
- Model prompt includes the window `label`, the window verdict, and the per-hour digest; discharge flagged "assumed steady from latest reading."

### 5. `app/components/kayak-chat.tsx`

- Per-message card verdict: `data.forecast?.verdict ?? data.briefing?.assessment?.verdict`.
- `setBriefing(data.briefing)` unchanged → hero + gauges stay live "now".
- `PaddleTimeline` gains a `title` prop rendered in `<h4>` → `"Sunday morning · wind"` when a target window is set, else `"Next N hours · wind"`. Thread the window label from `data.forecast.label` onto the message and into the timeline.
- Hero, gauges, and Compass untouched.

## Data flow

```
question
  → resolveWindow(question)            # lib/when.ts
  → fetchNwsHourlyWind()               # all ~156 hrs
  + fetchCurrentPredictions(date)      # NOAA hourly signed velocity
  → buildHourlyOutlook(target)         # per-hour wind + current, filtered to window
  → assessWindow(hourly)               # verdict from best ≥2h sub-window
  → generateObject(card)               # gpt-5-mini, prompt carries window label + verdict + digest
  → { card, forecast, hourly, window, briefing(NOW), readings }
  → UI: card re-anchors to window; hero stays NOW
```

## Error handling

- Target beyond ~6.5 days → NWS wind for that date is empty → the card states "I can't see past about a week out."
- NOAA current prediction fails → steady-current fallback (latest reading) + caveat; the wind-based verdict still stands. Matches the existing best-effort `try/catch` around the forecast.
- All wrapped in the existing route `try/catch`; the snapshot-only `buildFastAnswer` remains the floor when the model call fails.

## Testing

- **Unit:**
  - `resolveWindow` — weekday math across a week boundary (e.g. asking Friday about "Monday"), each daypart, `this weekend`, bare-day default, `now`/`current`/unparseable → `isNow`.
  - current sign → `ebb`/`flood` mapping and `knots = abs`.
  - `assessWindow` — best-window → verdict mapping, all-danger → `danger`, per-hour opposing-wind detection.
- **Integration:** mock NWS + NOAA; assert a "Sunday morning" question produces `hourly` filtered to Sunday 6–11 and a window verdict; assert a "now" question is unchanged (rolling 12h, `isNow: true`).

## Decisions locked during brainstorming

- Forecast scope: **wind + tidal current** (discharge assumed steady).
- Card behavior: **re-anchor** verdict/stats/chart to the target window.
- Surface: **web card only** now; forecast logic built as shared `lib` functions for later reuse in `trigger/chat.ts`.
- Date parsing: **deterministic resolver** (no LLM), with `isNow` fallback.
- Fetch strategy: **live per request**; no new ingestion/storage.
- "this weekend" → single upcoming Saturday; verdict = best workable sub-window within the target; `isNow` questions also get real per-hour current.
