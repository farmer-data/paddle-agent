# Tide-Current Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated tide-current section (a stacked ebb/flood curve) below the wind timeline in the reply card.

**Architecture:** Surface the per-hour tidal current (already computed for the wind-vs-tide check) as a signed value on `HourlyRisk`; add a pure `summarizeCurrent` for turn/peak annotations; the route returns a `current` object; a new `CurrentTimeline` recharts component draws the curve on the same x-axis as the wind chart.

**Tech Stack:** TypeScript, Next.js 16 (App Router, `nodejs` runtime), Vercel AI SDK (`generateObject`, gpt-5-mini), Recharts, Vitest.

## Global Constraints

- Signed current convention: **ebb negative, flood positive**; `null` when no prediction for that hour.
- The current curve shares the wind chart's window and x-axis (`dataKey="hourLabel"`); it is rendered directly below `PaddleTimeline`.
- Static annotations only (no tap interaction): now dot (only when `target.isNow`), next slack/turn, peak ebb/flood, salty caption.
- Keep the existing `CURRENT NOW` stat chip.
- Caption comes from a new model-authored card field `currentLine` (fallback deterministic line on the no-card path).
- Hour keys are `"YYYY-MM-DD HH"` via string slicing (both NWS and NOAA timestamps are Eastern) — never TZ math.
- Hide the whole section when there is no current data for the window.
- Do not touch the Trigger tasks, ingestion, or the live hero/gauges. Runtime stays `nodejs`.

---

### Task 1: Signed current + `summarizeCurrent` in `lib/windows.ts`

**Files:**
- Modify: `lib/windows.ts`
- Test: `lib/windows.test.ts`

**Interfaces:**
- Consumes: `CurrentPrediction` from `./sources` (`{ ts: string; knots: number; direction: "ebb" | "flood" }`); `resolveWindow` + `TUE_9AM` fixture in the test.
- Produces:
  ```ts
  // HourlyRisk gains: current: number | null   (signed knots; ebb negative, flood positive)
  export const hourKey: (ts: string) => string; // now exported
  export type CurrentSummary = {
    nextTurn: { atLabel: string; toPhase: "ebb" | "flood" } | null;
    peakEbb: { atLabel: string; knots: number } | null;   // knots = positive magnitude
    peakFlood: { atLabel: string; knots: number } | null; // knots = positive magnitude
  };
  export function summarizeCurrent(predictions: CurrentPrediction[], startKey: string, endKey: string): CurrentSummary;
  ```

- [ ] **Step 1: Write the failing tests**

First, in the existing top-of-file `import { ... } from "./windows";` line, add `summarizeCurrent` to the named imports (do NOT add a second import line — that would be a duplicate binding). Then append the following test blocks to `lib/windows.test.ts` (it already imports `resolveWindow`, `TUE_9AM`, and `type { CurrentPrediction } from "./sources"`):
```ts
describe("buildHourlyOutlook signed current", () => {
  it("attaches signed current per hour (ebb negative, flood positive, null when missing)", () => {
    const wind = [
      { ts: "2026-07-26T06:00:00-04:00", windKnots: 4, direction: "N" },
      { ts: "2026-07-26T07:00:00-04:00", windKnots: 5, direction: "N" },
      { ts: "2026-07-26T08:00:00-04:00", windKnots: 5, direction: "N" },
    ];
    const currentPreds: CurrentPrediction[] = [
      { ts: "2026-07-26 06:00", knots: 0.5, direction: "ebb" },
      { ts: "2026-07-26 07:00", knots: 0.3, direction: "flood" },
    ];
    const target = resolveWindow("Sunday morning?", TUE_9AM); // 2026-07-26, 06–11
    const out = buildHourlyOutlook(wind, currentPreds, {}, target);
    expect(out.map((h) => h.current)).toEqual([-0.5, 0.3, null]);
  });
});

describe("summarizeCurrent", () => {
  const preds: CurrentPrediction[] = [
    { ts: "2026-07-26 06:00", knots: 1.2, direction: "ebb" },   // -1.2
    { ts: "2026-07-26 07:00", knots: 0.4, direction: "ebb" },   // -0.4
    { ts: "2026-07-26 08:00", knots: 0.6, direction: "flood" }, // +0.6
    { ts: "2026-07-26 09:00", knots: 1.5, direction: "flood" }, // +1.5
  ];

  it("finds peak ebb/flood in the window and the interpolated next turn", () => {
    const s = summarizeCurrent(preds, "2026-07-26 06", "2026-07-26 09");
    expect(s.peakEbb).toEqual({ atLabel: "6 AM", knots: 1.2 });
    expect(s.peakFlood).toEqual({ atLabel: "9 AM", knots: 1.5 });
    // crossing between 07:00 (-0.4) and 08:00 (+0.6): frac 0.4 -> 07:24, turning to flood
    expect(s.nextTurn).toEqual({ atLabel: "7:24 AM", toPhase: "flood" });
  });

  it("returns null turn/peakFlood when ebb runs throughout", () => {
    const ebbOnly: CurrentPrediction[] = [
      { ts: "2026-07-26 06:00", knots: 1.0, direction: "ebb" },
      { ts: "2026-07-26 07:00", knots: 0.8, direction: "ebb" },
    ];
    const s = summarizeCurrent(ebbOnly, "2026-07-26 06", "2026-07-26 07");
    expect(s.nextTurn).toBeNull();
    expect(s.peakFlood).toBeNull();
    expect(s.peakEbb).toEqual({ atLabel: "6 AM", knots: 1.0 });
  });

  it("returns all null for empty predictions", () => {
    expect(summarizeCurrent([], "2026-07-26 06", "2026-07-26 09")).toEqual({ nextTurn: null, peakEbb: null, peakFlood: null });
  });
});
```
Note: `lib/windows.test.ts` already imports `resolveWindow`, `TUE_9AM`, and `type { CurrentPrediction } from "./sources"` (from the earlier window-outlook task). Reuse those; only add `summarizeCurrent` to the existing `./windows` import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- windows`
Expected: FAIL — `summarizeCurrent` not exported and `h.current` is `undefined`.

- [ ] **Step 3: Add signed `current` to `HourlyRisk` and export `hourKey`**

In `lib/windows.ts`, change the `HourlyRisk` type:
```ts
export type HourlyRisk = { ts: string; hourLabel: string; windKnots: number; direction: string; risk: Risk; opposing: boolean; current: number | null };
```
Change the `hourKey` declaration to export it:
```ts
export const hourKey = (ts: string) => ts.slice(0, 13).replace("T", " ");
```
In `buildHourlyOutlook`, inside the `.map`, add the signed current to the returned object (after `opposing: assessment.opposingWind,`):
```ts
      current: cur ? (cur.direction === "ebb" ? -cur.knots : cur.knots) : null,
```

- [ ] **Step 4: Add `CurrentSummary` + `summarizeCurrent`**

Append to `lib/windows.ts`:
```ts
export type CurrentSummary = {
  nextTurn: { atLabel: string; toPhase: "ebb" | "flood" } | null;
  peakEbb: { atLabel: string; knots: number } | null;
  peakFlood: { atLabel: string; knots: number } | null;
};

// NOAA "YYYY-MM-DD HH:MM" -> minutes past midnight (comparisons stay within one day/window).
const minutesOf = (ts: string) => Number(ts.slice(11, 13)) * 60 + Number(ts.slice(14, 16));
const clockLabel = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function summarizeCurrent(predictions: CurrentPrediction[], startKey: string, endKey: string): CurrentSummary {
  const series = predictions
    .map((p) => ({ ts: p.ts, key: hourKey(p.ts), signed: p.direction === "ebb" ? -p.knots : p.knots }))
    .sort((a, b) => a.ts.localeCompare(b.ts));

  let peakEbb: CurrentSummary["peakEbb"] = null;
  let peakFlood: CurrentSummary["peakFlood"] = null;
  for (const s of series) {
    if (s.key < startKey || s.key > endKey) continue;
    const label = labelForHour(hourOf(s.ts));
    if (s.signed < 0 && (!peakEbb || -s.signed > peakEbb.knots)) peakEbb = { atLabel: label, knots: -s.signed };
    if (s.signed > 0 && (!peakFlood || s.signed > peakFlood.knots)) peakFlood = { atLabel: label, knots: s.signed };
  }

  let nextTurn: CurrentSummary["nextTurn"] = null;
  const fromStart = series.filter((s) => s.key >= startKey);
  for (let i = 1; i < fromStart.length; i++) {
    const a = fromStart[i - 1];
    const b = fromStart[i];
    if (a.signed === 0 || b.signed === 0) continue;
    if (a.signed < 0 !== b.signed < 0) {
      const frac = Math.abs(a.signed) / (Math.abs(a.signed) + Math.abs(b.signed));
      const crossing = Math.round(minutesOf(a.ts) + frac * (minutesOf(b.ts) - minutesOf(a.ts)));
      nextTurn = { atLabel: clockLabel(crossing), toPhase: b.signed < 0 ? "ebb" : "flood" };
      break;
    }
  }

  return { nextTurn, peakEbb, peakFlood };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- windows`
Expected: PASS (existing windows tests + the 4 new ones).

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass. If `typecheck` reports errors in `app/api/chat/route.ts` or `app/components/kayak-chat.tsx` about a missing `current` property on `HourlyRisk`, that is expected (later tasks add it) — note it and continue.

- [ ] **Step 7: Commit**

```bash
git add lib/windows.ts lib/windows.test.ts
git commit -m "Surface signed per-hour current and add current-summary"
```

---

### Task 2: Return a `current` object from the chat route

**Files:**
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: `summarizeCurrent`, `hourKey`, `type CurrentSummary` from `@/lib/windows`; existing `CurrentPrediction` import.
- Produces: JSON response gains
  ```ts
  current: { nowSigned: number | null; summary: CurrentSummary; caption: string } | null
  ```
  and the card schema gains `currentLine: string`.

- [ ] **Step 1: Extend the windows import**

At the top of `app/api/chat/route.ts`, change the `@/lib/windows` import to add the three names:
```ts
import { buildHourlyOutlook, assessWindow, summarizeCurrent, hourKey, type HourlyRisk, type PaddleWindow, type CurrentSummary } from "@/lib/windows";
```

- [ ] **Step 2: Add `currentLine` to the card schema**

In `cardSchema`, add this field (place it right after the `note` field):
```ts
  currentLine: z.string().describe("one salty line about the tidal current for this window, max 12 words"),
```

- [ ] **Step 3: Hoist the current predictions out of the forecast try**

Find:
```ts
    let hourly: HourlyRisk[] = [];
    let window: PaddleWindow | null = null;
```
Replace with:
```ts
    let hourly: HourlyRisk[] = [];
    let currentPreds: CurrentPrediction[] = [];
    let window: PaddleWindow | null = null;
```
Then inside the `try`, find:
```ts
      const [wind, current] = await Promise.all([
        fetchNwsHourlyWind(),
        fetchCurrentPredictions(target.date).catch(() => [] as CurrentPrediction[]),
      ]);
      hourly = buildHourlyOutlook(wind, current, { dischargeCfs: values.discharge }, target);
```
Replace with:
```ts
      const [wind, cp] = await Promise.all([
        fetchNwsHourlyWind(),
        fetchCurrentPredictions(target.date).catch(() => [] as CurrentPrediction[]),
      ]);
      currentPreds = cp;
      hourly = buildHourlyOutlook(wind, cp, { dischargeCfs: values.discharge }, target);
```

- [ ] **Step 4: Compute the current summary + now value + fallback caption**

Immediately after the `hccbNote` assignment (the line ending `: "";`) and before the `try {` that calls `generateObject`, insert:
```ts
    const currentDirNow = values.current_dir === undefined ? undefined : (values.current_dir > 90 && values.current_dir < 270 ? "ebb" : "flood");
    const nowSigned = values.current_speed === undefined || !target.isNow
      ? null
      : (currentDirNow === "flood" ? values.current_speed : -values.current_speed);
    const currentSummary: CurrentSummary = hourly.length
      ? summarizeCurrent(currentPreds, hourKey(hourly[0].ts), hourKey(hourly[hourly.length - 1].ts))
      : { nextTurn: null, peakEbb: null, peakFlood: null };
    const hasCurve = hourly.some((h) => h.current !== null);
    const firstSigned = hourly.find((h) => h.current !== null)?.current ?? null;
    const fallbackCaption = firstSigned === null ? "" : firstSigned < 0 ? "ebb — free ride out, you pay coming back" : "flood — you earn every stroke out";
```

- [ ] **Step 5: Include `current` on the success (card) response**

Find the success return:
```ts
      return Response.json({ card: safeCard, text: null, readings, briefing, hourly, window, forecast });
```
Replace with:
```ts
      const current = hasCurve ? { nowSigned, summary: currentSummary, caption: clean(card.currentLine) } : null;
      return Response.json({ card: safeCard, text: null, readings, briefing, hourly, window, forecast, current });
```

- [ ] **Step 6: Include `current` on the fallback response**

Find the catch-path return:
```ts
      return Response.json({ card: null, text: buildFastAnswer(message, readings), readings, briefing, hourly, window, forecast });
```
Replace with:
```ts
      const current = hasCurve ? { nowSigned, summary: currentSummary, caption: fallbackCaption } : null;
      return Response.json({ card: null, text: buildFastAnswer(message, readings), readings, briefing, hourly, window, forecast, current });
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors in `app/api/chat/route.ts`. (A remaining `current` error in `app/components/kayak-chat.tsx` is expected until Task 3.)

- [ ] **Step 8: Drive the running dev server**

Restart the app if needed: `npm run dev` (serves at `http://localhost:3000`). Then:
```bash
curl -s -X POST http://localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"message":"How is the current tomorrow evening?"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); c=d.get('current'); print('current:', {k: c.get(k) for k in ('nowSigned','caption')} if c else None); print('summary:', (c or {}).get('summary')); print('hourly current sample:', [h.get('current') for h in (d.get('hourly') or [])][:6])"
```
Expected: `current` is non-null with a `summary` (nextTurn/peakEbb/peakFlood) and a `caption`; `hourly` entries carry signed `current` values (negatives for ebb, positives for flood).

- [ ] **Step 9: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "Return tide-current summary + caption from the chat route"
```

---

### Task 3: `CurrentTimeline` component + wiring

**Files:**
- Modify: `app/components/kayak-chat.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: the route's `current` object (Task 2) and the signed `hourly[].current` (Task 1); `type CurrentSummary` from `@/lib/windows`.
- Produces: a `CurrentTimeline` rendered below `PaddleTimeline` in both reply variants.

- [ ] **Step 1: Extend imports and types**

In `app/components/kayak-chat.tsx`, change the recharts import to add `Area, AreaChart, ReferenceDot`:
```tsx
import { Area, AreaChart, Bar, BarChart, Cell, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
```
Change the windows type import to add `CurrentSummary`:
```tsx
import type { CurrentSummary, HourlyRisk, PaddleWindow } from "@/lib/windows";
```
Add a `CurrentInfo` type and extend `Message` (just after the `Forecast`/`Message` type lines):
```tsx
type CurrentInfo = { nowSigned: number | null; summary: CurrentSummary; caption: string };
```
Then add `current?: CurrentInfo | null;` to the `Message` type:
```tsx
type Message = { role: "user" | "assistant"; text: string; pending?: boolean; card?: ReplyCard | null; verdict?: Risk | null; hourly?: HourlyRisk[]; window?: PaddleWindow | null; forecast?: Forecast | null; current?: CurrentInfo | null };
```

- [ ] **Step 2: Add the `CurrentTimeline` component**

Add this component just after the `PaddleTimeline` function (before `CardReply`):
```tsx
const EBB = "var(--cyan)";
const FLOOD = "var(--go)";

function CurrentTimeline({ hourly, current, title }: { hourly: HourlyRisk[]; current: CurrentInfo; title?: string }) {
  const data = hourly.map((h) => ({
    hourLabel: h.hourLabel,
    ebb: h.current != null && h.current < 0 ? h.current : 0,
    flood: h.current != null && h.current > 0 ? h.current : 0,
    signed: h.current,
  }));
  const max = Math.max(0.5, ...data.map((d) => Math.abs(d.signed ?? 0)));
  const { nextTurn, peakEbb, peakFlood } = current.summary;
  return (
    <div className="timeline current-timeline">
      <div className="timeline-head">
        <h4>{title ? `${title} · current` : "Current now"}</h4>
        {nextTurn && (
          <span className="window-chip" style={{ "--risk-color": nextTurn.toPhase === "ebb" ? EBB : FLOOD } as React.CSSProperties}>
            Turns {nextTurn.toPhase} {nextTurn.atLabel}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <ReferenceLine y={0} stroke="var(--line-strong)" strokeOpacity={0.7} />
          <XAxis dataKey="hourLabel" tickLine={false} axisLine={false} interval={1} tick={{ fill: "var(--faint)", fontSize: 10, fontFamily: "var(--mono)" }} />
          <YAxis width={26} domain={[-max, max]} tickLine={false} axisLine={false} tick={{ fill: "var(--faint)", fontSize: 10, fontFamily: "var(--mono)" }} tickFormatter={(v: number) => Math.abs(v).toFixed(1)} />
          <Tooltip cursor={{ stroke: "var(--line-strong)" }} contentStyle={{ background: "var(--deep)", border: "1px solid var(--line-strong)", borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: "var(--muted)" }} itemStyle={{ color: "var(--text)" }}
            formatter={(_v, _n, item) => { const s = (item?.payload as { signed: number | null } | undefined)?.signed; return [s == null ? "—" : `${Math.abs(s).toFixed(2)} kn ${s < 0 ? "ebb" : "flood"}`, "current"]; }} />
          <Area dataKey="flood" type="monotone" stroke={FLOOD} fill={FLOOD} fillOpacity={0.22} isAnimationActive={false} />
          <Area dataKey="ebb" type="monotone" stroke={EBB} fill={EBB} fillOpacity={0.22} isAnimationActive={false} />
          {current.nowSigned != null && data.length > 0 && (
            <ReferenceDot x={data[0].hourLabel} y={current.nowSigned} r={4} fill={current.nowSigned < 0 ? EBB : FLOOD} stroke="white" strokeWidth={1.5} />
          )}
        </AreaChart>
      </ResponsiveContainer>
      {(peakEbb || peakFlood) && (
        <p className="tide-peaks">
          {peakEbb && <span style={{ color: EBB }}>▼ ebb {peakEbb.knots.toFixed(1)} {peakEbb.atLabel}</span>}
          {peakEbb && peakFlood && <span className="tide-dot"> · </span>}
          {peakFlood && <span style={{ color: FLOOD }}>▲ flood {peakFlood.knots.toFixed(1)} {peakFlood.atLabel}</span>}
        </p>
      )}
      {current.caption && <p className="guide-note tide-quip">“{current.caption}”</p>}
    </div>
  );
}
```

- [ ] **Step 3: Render `CurrentTimeline` in `CardReply`**

Change the `CardReply` signature to accept `current`:
```tsx
function CardReply({ card, verdict, hourly, window, windowLabel, current, onAsk }: { card: ReplyCard; verdict?: Risk | null; hourly?: HourlyRisk[]; window?: PaddleWindow | null; windowLabel?: string; current?: CurrentInfo | null; onAsk: (q: string) => void }) {
```
Just after the `PaddleTimeline` line in `CardReply`, add:
```tsx
        {current && hourly && hourly.some((h) => h.current != null) && <CurrentTimeline hourly={hourly} current={current} title={windowLabel} />}
```

- [ ] **Step 4: Render `CurrentTimeline` in `AssistantReply`**

Change the `AssistantReply` signature to accept `current`:
```tsx
function AssistantReply({ text, pending, hourly, window, windowLabel, current }: { text: string; pending?: boolean; hourly?: HourlyRisk[]; window?: PaddleWindow | null; windowLabel?: string; current?: CurrentInfo | null }) {
```
Just after the `PaddleTimeline` line in `AssistantReply`, add:
```tsx
        {current && hourly && hourly.some((h) => h.current != null) && <CurrentTimeline hourly={hourly} current={current} title={windowLabel} />}
```

- [ ] **Step 5: Thread `current` from `ask` and the render**

In `ask`, add `current: data.current` to the assistant message object. Change:
```tsx
      setMessages((old) => old.map((item, index) => index === old.length - 1 ? { role: "assistant", text: data.text ?? "", card: data.card, verdict: data.forecast ? data.forecast.verdict : (data.briefing?.assessment?.verdict ?? null), hourly: data.hourly, window: data.window, forecast: data.forecast } : item));
```
to:
```tsx
      setMessages((old) => old.map((item, index) => index === old.length - 1 ? { role: "assistant", text: data.text ?? "", card: data.card, verdict: data.forecast ? data.forecast.verdict : (data.briefing?.assessment?.verdict ?? null), hourly: data.hourly, window: data.window, forecast: data.forecast, current: data.current } : item));
```
In the `messages.map(...)` render, pass `current={message.current}` to both replies. Change:
```tsx
                  ? <CardReply card={message.card} verdict={message.verdict} hourly={message.hourly} window={message.window} windowLabel={message.forecast && !message.forecast.isNow ? message.forecast.label : undefined} onAsk={ask} />
                  : <AssistantReply text={message.text} pending={message.pending} hourly={message.hourly} window={message.window} windowLabel={message.forecast && !message.forecast.isNow ? message.forecast.label : undefined} />}
```
to:
```tsx
                  ? <CardReply card={message.card} verdict={message.verdict} hourly={message.hourly} window={message.window} windowLabel={message.forecast && !message.forecast.isNow ? message.forecast.label : undefined} current={message.current} onAsk={ask} />
                  : <AssistantReply text={message.text} pending={message.pending} hourly={message.hourly} window={message.window} windowLabel={message.forecast && !message.forecast.isNow ? message.forecast.label : undefined} current={message.current} />}
```

- [ ] **Step 6: Add styles**

Append to `app/globals.css`:
```css
.current-timeline { margin-top: 10px; }
.tide-peaks { margin: 4px 0 0; font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.04em; }
.tide-peaks .tide-dot { color: var(--faint); }
.tide-quip { margin-top: 6px; }
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 8: Verify in the browser**

With the dev server running (`npm run dev`), load `http://localhost:3000` and:
- Click "Show current Hudson conditions" (isNow) → confirm a **current** section renders below the wind chart: ebb fills below the slack line, flood above, a `now` dot, and the caption. Take a screenshot and look at it (a blank frame = failure).
- Ask "How's the current tomorrow evening?" (future window) → confirm the section title reads "tomorrow evening · current", no now-dot, and turn/peak labels show.

- [ ] **Step 9: Commit**

```bash
git add app/components/kayak-chat.tsx app/globals.css
git commit -m "Add stacked tide-current timeline below the wind chart"
```

---

## Self-Review Notes

- **Spec coverage:** signed `HourlyRisk.current` + `summarizeCurrent` (Task 1); route `current` object + `currentLine` caption + `nowSigned` for isNow only (Task 2); `CurrentTimeline` stacked area with slack line, now dot, turn/peak annotations, caption, hide-when-empty, shared x-axis, kept `CURRENT NOW` chip (Task 3). Edge cases (no data hides section; future window skips now-dot; ebb-throughout → null turn) covered by Task 1 tests + Task 3 render guards.
- **Type consistency:** `CurrentSummary` (nextTurn/peakEbb/peakFlood), `CurrentInfo` (nowSigned/summary/caption), and `HourlyRisk.current: number | null` are used identically across route and component. `hourKey` is exported once (Task 1) and imported by the route (Task 2).
- **No placeholders:** every code step contains complete code; commands include expected output. Route + component are verified live (curl + browser screenshot) rather than with a mocked HTTP/OpenAI test, matching the existing project pattern.
