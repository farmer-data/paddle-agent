# Dedicated tide-current section — Design

**Date:** 2026-07-21
**Status:** Approved, ready for implementation plan
**Scope:** `lib/windows.ts`, `app/api/chat/route.ts`, `app/components/kayak-chat.tsx`. Out of scope: Trigger tasks, ingestion, the live hero/gauges.

## Problem

The tidal current currently appears only as a small `CURRENT NOW` stat chip. The wind gets a rich, dedicated timeline section; the current does not. Users want the current to be its own part of the reply card, below the wind timeline.

## Decisions (from brainstorming)

- **Visual form:** a **tide curve** — a stacked area of signed tidal velocity (flood above the center line, ebb below, center = slack). Distinct from the spiky wind bars; honest to the tide's smooth, cyclical shape.
- **Time axis:** **aligned with the wind chart** — same window and hours, stacked directly below, shared x-axis. The next slack/turn is shown as a text label even when it falls just past the drawn window.
- **Interaction:** **static with always-visible annotations** — no tapping. A `now` dot (when the window includes now), the next slack/turn time, peak ebb/flood, and a salty one-line caption.
- The existing `CURRENT NOW` stat chip **stays** (parallel to how wind keeps its `WIND NOW` chip *and* its timeline).

## Units

### 1. `lib/windows.ts`

**Extend `HourlyRisk`:**
```ts
export type HourlyRisk = {
  ts: string; hourLabel: string; windKnots: number; direction: string;
  risk: Risk; opposing: boolean;
  current: number | null; // signed knots: ebb negative, flood positive; null if no prediction that hour
};
```
`buildHourlyOutlook` already looks up the per-hour prediction `cur` for the wind-vs-tide check — set `current` from it: `cur ? (cur.direction === "ebb" ? -cur.knots : cur.knots) : null`. This is what aligns the curve to the wind hours for free.

**Add a pure summary function:**
```ts
export type CurrentSummary = {
  nextTurn: { atLabel: string; toPhase: "ebb" | "flood" } | null;
  peakEbb: { atLabel: string; knots: number } | null;   // knots is the positive magnitude
  peakFlood: { atLabel: string; knots: number } | null;
};
export function summarizeCurrent(predictions: CurrentPrediction[], startKey: string, endKey: string): CurrentSummary;
```
- `startKey`/`endKey` are `"YYYY-MM-DD HH"` hour keys bounding the drawn window (the route derives them from `hourly[0].ts` and `hourly[last].ts` via the same string-slice as the existing `hourKey`). Export `hourKey` from `windows.ts` for reuse.
- `peakEbb`/`peakFlood`: the strongest ebb and flood **within** `[startKey, endKey]` (by signed magnitude), labelled with `labelForHour`.
- `nextTurn`: the first sign change in `predictions` at/after `startKey` — **may fall past `endKey`** (so "turns to flood ~6:40a" works even just past the window). Time is linear-interpolated between the two bracketing predictions (NOAA `"YYYY-MM-DD HH:MM"` ts parse cleanly), rendered to ~:10 precision; `toPhase` is the direction after the crossing. `null` when no turn is found in `predictions` after `startKey` (e.g., ebb throughout).

### 2. `app/api/chat/route.ts`

- `hourly` now carries signed `current` per hour (free from the `HourlyRisk` change) — the curve reads it directly.
- After building `hourly` (when non-empty), compute:
  - `const currentSummary = summarizeCurrent(current, hourKey(hourly[0].ts), hourKey(hourly[hourly.length - 1].ts));`
  - `nowSigned`: from the **live** reading, only when the window includes now (`target.isNow`): `values.current_speed === undefined ? null : (currentDirection === "ebb" ? -values.current_speed : values.current_speed)`, reusing the same ebb/flood derivation as `buildQuickBriefing` (southward `current_dir` ⇒ ebb). `null` for future windows.
- Add a `current` object to the JSON response:
  ```ts
  current: { nowSigned: number | null; summary: CurrentSummary; caption: string } | null
  ```
  `null` when there is no usable current (all `hourly[].current` null). `caption` = the model's `currentLine` (below) when a card was produced, else a deterministic salty line derived from `currentNote`.
- **Card schema:** add an always-present field so the voice stays model-driven:
  ```ts
  currentLine: z.string().describe("one salty line about the tidal current for this window, max 12 words"),
  ```
  Run it through the existing `clean()`.

### 3. `app/components/kayak-chat.tsx`

- Types: `Message`/response gain `current?: { nowSigned: number | null; summary: CurrentSummary; caption: string } | null`. Import `CurrentSummary` from `@/lib/windows`.
- New **`CurrentTimeline`** component, rendered directly below `PaddleTimeline` in **both** `CardReply` and `AssistantReply`:
  - Data per hour: `{ hourLabel, ebb: current < 0 ? current : 0, flood: current > 0 ? current : 0 }` (null current ⇒ both 0).
  - Recharts `AreaChart` with **two Areas** split at zero — ebb color below the axis, flood color above — a `ReferenceLine y={0}` for slack, and a **symmetric y-domain** `[-max, +max]`.
  - `ReferenceDot` at `now` when `current.nowSigned != null` (x = `hourly[0].hourLabel`).
  - Small labels/dots for `summary.nextTurn` and `summary.peakEbb`/`peakFlood`.
  - Shared x-axis with the wind chart (`dataKey="hourLabel"`), so the two stack in register.
  - Caption line (`current.caption`) beneath the chart.
  - **Render only** when `current` is present and `hourly` has at least one non-null `current`.
- Header: `"CURRENT · {windowLabel}"` (mirrors the wind timeline's title), or `"CURRENT NOW"` for `isNow`.

## Data flow

```
fetchCurrentPredictions(target.date)  ─┐
fetchNwsHourlyWind()                  ─┴─▶ buildHourlyOutlook → hourly[] (now carries signed current)
                                            summarizeCurrent(predictions, startKey, endKey) → CurrentSummary
route → { ..., hourly, current: { nowSigned, summary, caption } }
component → CurrentTimeline draws the tide curve under the wind chart, same axis
```

## Edge cases

- No current for the window (all `hourly[].current` null, or `current` object null) → **hide the section** (as the wind timeline hides when empty).
- Future window (no "now") → skip the now dot; curve + turn/peak still render.
- No turn after the window start anywhere in the day's predictions → `nextTurn` null; omit the turn label (caption still shows).
- `isNow` window spanning midnight → predictions cover only `target.date`, so post-midnight hours have null current (existing limitation); the curve simply stops carrying data there.

## Testing

- **Unit (`lib/windows.test.ts`):**
  - `buildHourlyOutlook` sets signed `current` per hour: ebb ⇒ negative, flood ⇒ positive, `null` when no prediction for that hour.
  - `summarizeCurrent`: peak ebb vs flood within the window; `nextTurn` zero-crossing detection incl. interpolation and `toPhase`; turn allowed past `endKey`; ebb-throughout ⇒ `nextTurn` null; empty predictions ⇒ all null.
- **Live:** run the app, ask a current/tide question, screenshot the stacked wind + current charts; confirm ebb below / flood above / slack line, the now dot, and the turn/peak labels render (not a blank frame).

## Decisions locked

Tide curve · aligned/stacked shared axis · static annotations · keep the `CURRENT NOW` chip · caption from a model-authored `currentLine` · signed current surfaced on `HourlyRisk` · summary computed server-side from full-day predictions.
