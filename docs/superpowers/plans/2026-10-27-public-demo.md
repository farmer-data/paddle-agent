# Paddle Agent Public Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Paddle Agent into a public, phone-first NYC paddling guide covering six Hudson and East River zones. It gets a verdict-first home screen, a map with a route planner, browser-stored trips, and a rate-limited Qwen chat, with Trigger.dev and ClickHouse removed.

**Architecture:**
- **Engine:** pure TypeScript modules in `lib/` (zones, verdict rules, outlook, best window, route graph and time model, trips). They run on the server for the chat tools and in the browser for the home screen, map and route planner.
- **Data endpoint:** one `GET /api/outlook` fetches raw USGS, NOAA, NWS and Open-Meteo data per zone, using the Next fetch cache. The client turns it into verdicts for the selected mode, so switching mode needs no refetch.
- **Chat:** `POST /api/chat` streams AI SDK 6 with Qwen through the OpenAI-compatible provider. It sits behind counters in one free Marketplace key-value store.

**Tech Stack:** Next.js 16, React 19, AI SDK 6 (`ai@^6`, `@ai-sdk/react@^3`, `@ai-sdk/openai-compatible@^2`), Zod 4, MapLibre GL, suncalc, Recharts, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-public-demo-design.md`. Read it first. It is the source of every number and copy string below.

## Global Constraints

- No Trigger.dev, no ClickHouse, no OpenAI, no paid service. The only new infrastructure is **one free-tier key-value store from the Vercel Marketplace**, holding rate-limit counters only.
- Env vars:
  - `QWEN_API_KEY` (required)
  - `QWEN_BASE_URL` (default `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`)
  - `QWEN_MODEL` (default `qwen-plus`)
  - plus whatever the store integration injects
- Stay on AI SDK 6. `@ai-sdk/openai-compatible@^2` shares `@ai-sdk/provider@3.0.19` with `ai@6.0.316` (verified 2026-10-27).
- Every threshold, speed and limit lives in `lib/config.ts`. No magic numbers elsewhere.
- Missing or stale data **never** yields 🟢. A known 🔴 still shows as 🔴. Otherwise anything missing shows grey "No verdict".
- All clock logic uses **America/New_York** wall-clock time, never the server's timezone (Vercel runs in UTC).
- No user data stored on the server. Trips live in `localStorage` and are sent with chat requests.
- Phone-first. On desktop (≥ 900 px) the layout is two columns: map on the left, verdict and chat on the right.
- Keep today's palette and fonts (`app/globals.css`, `app/layout.tsx`).
- Fixed copy (use verbatim):
  - `Water {N} °F — wetsuit or drysuit required`
  - `Water temperature unavailable — assume cold, wetsuit or drysuit required`
  - `Recent heavy rain — sewage overflow likely, avoid water contact`
  - `No 🟢 window today`
  - `Least risky: 🟡 {start}–{end}`
  - `Not for first-season paddlers`
  - `Crosses a ferry lane — not for first-season paddlers`
  - `Ferry lane — cross quickly, look both ways, cross at a right angle`
  - `Couldn't reach {source}`
  - `The guide is unavailable right now`
  - `Planning estimate, not a guarantee of safe passage.`

## Review Focus

1. **Server in UTC, users in New York.** At 9 PM in New York it is already 01:00 UTC the next day. "Today", "now", the hour strip, `resolveWindow` and sunset must all follow New York time. Tests: Task 4 `stripHours` and Task 8 `resolveWindow`, both with UTC instants.
2. **DST ends on 2026-11-01, days after launch.** New York gets a repeated 1 AM hour. The outlook must not crash, double-count or misalign hours. Test: Task 4 "DST fall-back".
3. **Partial upstream failure.** One NOAA station or the NWS `points` lookup failing must grey only the affected zones or hours, naming the source. Every other zone keeps its verdict. Test: Task 5.
4. **Blocked or corrupt browser storage** (Safari private mode, hand-edited JSON). Trips load as `[]`, zone and mode fall back to their defaults, and nothing throws. Test: Task 8.
5. **Hostile or malformed chat requests:**
   - message longer than 500 characters
   - more than 50 trips
   - unknown zone id
   - non-JSON body
   - any of these returns 400 without calling the model

   Test: Task 10.

---

## File map

| File | Responsibility |
|---|---|
| `lib/config.ts` (new) | All thresholds, speeds, limits, alert names |
| `lib/time.ts` (new) | NY wall-clock helpers, hour keys and labels, sun times |
| `lib/geo.ts` (new) | distance, bearing, angle diff, point-in-polygon, interpolation |
| `lib/zones.ts` (new) | 6 zones, launches and landmarks, lookups |
| `lib/verdict.ts` (new) | `assessHour`: rules per hour, zone and mode |
| `lib/sources.ts` (rewrite) | Upstream fetchers, each throwing on failure |
| `lib/outlook.ts` (new) | Pure: inputs → `ZoneOutlook` (hours, best window, strip, gear, rain, current) |
| `lib/outlook-data.ts` (new) | Server: fetches all sources into `OutlookInputs` |
| `lib/route/graph.ts`, `lib/route/waterways.ts` (new) | Waterway graph data and shortest path |
| `lib/route/plan.ts` (new) | Route time model, segment verdicts, suggested departure |
| `lib/trips.ts`, `lib/compare.ts`, `lib/trip-snapshot.ts` (new) | Trip type and storage, rough-trip stats and window forecast, snapshots |
| `lib/rate-limit.ts`, `lib/counter-store.ts` (new) | Limit logic, store adapter |
| `lib/agent/{model,prompt,tools,types}.ts` (new) | Qwen model, system prompt, tools, chat UI message types |
| `app/api/outlook/route.ts`, `app/api/chat/route.ts` (new) | Endpoints |
| `app/components/*` | Home (A), chat sheet (ported from `kayak-chat.tsx`), map, route panel, trips sheet |
| Deleted in Task 11 | `trigger/`, `trigger.config.ts`, `app/actions.ts`, `app/api/conditions/`, `lib/clickhouse.ts`, `db/`, `lib/safety.ts`, `lib/windows.ts`, `lib/briefing.ts`, `lib/forecast.ts`, `lib/chat-types.ts`, their tests, `scripts/*` |

New engine modules sit beside the old ones until Task 11, so `npm run typecheck` and `npm test` stay green at every commit.

---

### Task 1: Config, time, geo and zone data

**Files:**
- Create: `lib/config.ts`, `lib/time.ts`, `lib/geo.ts`, `lib/zones.ts`
- Test: `lib/time.test.ts`, `lib/geo.test.ts`, `lib/zones.test.ts`

**Interfaces:**
- Produces:
  - `type Mode = "beginner" | "experienced"`
  - `CONFIG` (shape below)
  - `type ZoneId = "upper-hudson" | "midtown-hudson" | "lower-hudson" | "lower-east" | "midtown-east" | "hell-gate"`
  - `type LonLat = [number, number]`
  - `type Zone = { id: ZoneId; name: string; river: "hudson" | "east"; currentStation: string; center: LonLat; shape: LonLat[]; usesHudsonFlow: boolean; beginnerNoGo: boolean }`
  - `type Place = { id: string; name: string; aliases: string[]; kind: "launch" | "landmark"; lonLat: LonLat; zoneId: ZoneId; nodeId: string; note?: string }`
  - `ZONES`, `PLACES`, `zoneById(id)`, `isZoneId(x): x is ZoneId`, `zoneAt(p: LonLat): ZoneId | null`, `nearestZone(p: LonLat): ZoneId`, `DEFAULT_ZONE: ZoneId = "lower-hudson"`
  - `lib/time.ts`:
    - `nyParts(d: Date): { date: string; hour: number; minute: number; dow: number }`
    - `nyStamp(d: Date): string` (`"YYYY-MM-DD HH:MM"`)
    - `hourKey(ts: string): string` (`"YYYY-MM-DD HH"`, same slicing as today's `lib/windows.ts`)
    - `hourLabel(h: number): string` (`"3 PM"`)
    - `addDays(date: string, n: number): string`
    - `wallMinutes(stamp: string): number`
    - `wallStamp(min: number): string`
    - `sunTimes(date: string, p: LonLat): { sunrise: string; sunset: string }` (NY `"YYYY-MM-DD HH:MM"`)
  - `lib/geo.ts`:
    - `distanceNm(a, b)`
    - `bearingDeg(a, b)`
    - `angleDiff(a, b): number` (0–180)
    - `pointInPolygon(p, poly)`
    - `lerp(a: LonLat, b: LonLat, t): LonLat`

`CONFIG` (values from the spec; drafts are marked in comments):

```ts
export const CONFIG = {
  thresholds: {
    beginner:    { wind: { caution: 8,  danger: 12 }, current: { caution: 1.0, danger: 2.0 } },
    experienced: { wind: { caution: 12, danger: 18 }, current: { caution: 2.0, danger: 3.0 } },
    flow: { caution: 15_000, danger: 25_000 },
  },
  opposing: { maxAngleDeg: 45, minCurrentKn: 0.5 }, // min current: builder's call per spec
  noGoAlerts: ["Small Craft Advisory", "Gale Warning", "Storm Warning", "Hurricane Force Wind Warning",
    "Special Marine Warning", "Severe Thunderstorm Warning", "Tropical Storm Warning", "Hurricane Warning"],
  coldWaterF: 60,
  coldSeasonMonths: [11, 12, 1, 2, 3, 4, 5, 6], // Nov 1 – Jun 30
  rainBadgeInches48h: 0.25,
  maxAge: { observationMin: 90, forecastHours: 6 },
  outlookHours: 48,
  route: { paddleKn: { beginner: 2.5, experienced: 3.5 }, headwindPenalty: 0.1, minHeadwayKn: 0.5, stepMin: 15, maxHours: 8, departureStepMin: 30 },
  chat: { maxMessageChars: 500, historyMessages: 12, maxTrips: 50, maxSteps: 4, maxOutputTokens: 1200 },
  rateLimit: { perIpHour: 20, perIpDay: 50, siteDay: 500 },
} as const;
```

**Zone data:**
- Use the spec's zone table for ids, stations, Hudson flow and `beginnerNoGo` (only `hell-gate`).
- `shape` is a hand-drawn **water polygon** of 10–40 vertices covering that stretch of river, traced on a map.
- Adjacent zones share their boundary edge.
- `center` is a point in mid-river, used as the NWS forecast point and alert point.

**Places:**
- Launches: verify each one is a real public launch (NYC Parks, Hudson River Park, or the City of Hoboken), starting from the spec's candidates. Record coordinates from the map.
- Landmarks: Little Red Lighthouse, Intrepid, Brooklyn Bridge, Williamsburg Bridge, Roosevelt Island Lighthouse.
- `nodeId` stays `""` until Task 6 fills it in.
- `id` is the kebab-case name: `pier-40`, `pier-96`, `hoboken-cove`, `intrepid`, and so on.
- `aliases` hold the short names people type, e.g. `["pier 40"]` or `["hoboken"]`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/time.test.ts
it("uses New York wall clock even when UTC is the next day", () => {
  expect(nyParts(new Date("2026-07-26T01:30:00Z"))).toMatchObject({ date: "2026-07-25", hour: 21, minute: 30 });
  expect(nyStamp(new Date("2026-12-01T17:05:00Z"))).toBe("2026-12-01 12:05");
});
it("round-trips wall minutes", () => expect(wallStamp(wallMinutes("2026-07-26 14:45") + 30)).toBe("2026-07-26 15:15"));
it("labels hours", () => { expect(hourLabel(0)).toBe("12 AM"); expect(hourLabel(15)).toBe("3 PM"); });
it("gives NY sunrise/sunset", () => {
  const { sunrise, sunset } = sunTimes("2026-10-26", [-74.0, 40.75]);
  expect(sunrise.slice(0, 13)).toBe("2026-10-26 07"); expect(sunset.slice(0, 13)).toBe("2026-10-26 17");
});
// lib/geo.test.ts
it("measures angle differences across north", () => { expect(angleDiff(350, 10)).toBe(20); expect(angleDiff(183, 3)).toBe(180); });
it("measures ~1 nm per minute of latitude", () => expect(distanceNm([-74, 40.70], [-74, 40.7166667])).toBeCloseTo(1, 1));
// lib/zones.test.ts
const STATIONS: Record<ZoneId, LonLat> = { "upper-hudson": [-73.9498, 40.8496], "midtown-hudson": [-74.0028, 40.7707],
  "lower-hudson": [-74.0253, 40.7076], "lower-east": [-73.9977, 40.706], "midtown-east": [-73.9657, 40.7347], "hell-gate": [-73.9383, 40.7783] };
it("has six zones whose polygons contain their centre and current station", () => {
  expect(ZONES.map((z) => z.id).sort()).toEqual(Object.keys(STATIONS).sort());
  for (const z of ZONES) { expect(zoneAt(z.center)).toBe(z.id); expect(zoneAt(STATIONS[z.id])).toBe(z.id); }
});
it("flags flow and Hell Gate correctly", () => {
  expect(ZONES.filter((z) => z.usesHudsonFlow).map((z) => z.river)).toEqual(["hudson", "hudson", "hudson"]);
  expect(ZONES.filter((z) => z.beginnerNoGo).map((z) => z.id)).toEqual(["hell-gate"]);
});
it("has at least one launch per zone and unique place ids", () => {
  for (const z of ZONES) expect(PLACES.some((p) => p.kind === "launch" && p.zoneId === z.id)).toBe(true);
  expect(new Set(PLACES.map((p) => p.id)).size).toBe(PLACES.length);
});
it("finds the nearest zone from land", () => expect(nearestZone([-73.99, 40.735])).toMatch(/hudson|east/));
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run `npx vitest run lib/time.test.ts lib/geo.test.ts lib/zones.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 3: Install suncalc and implement**

- Run `npm install suncalc`. Add `@types/suncalc` only if suncalc ships no types.
- Implement the four modules. `nyParts` uses `Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hourCycle: "h23" })`, the same pattern as `nyDateTime` in `lib/clickhouse.ts`.
- `wallMinutes` and `wallStamp` treat the stamp as floating wall-clock time via `Date.UTC`. DST hours are ignored on purpose, since they always fall at night, which is always no-go.
- `nearestZone` returns `zoneAt(p)`, or else the zone whose centre is closest.
- If a launch can't be confirmed as a public launch, leave it out. The "at least one launch per zone" test then tells you which zone still needs a site.

- [ ] **Step 4: Run the tests to make sure they pass**

Run `npx vitest run lib/time.test.ts lib/geo.test.ts lib/zones.test.ts && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

`git add lib/config.ts lib/time.ts lib/geo.ts lib/zones.ts lib/*.test.ts package.json package-lock.json && git commit -m "feat: zones, config and NY time helpers"`

---

### Task 2: Verdict engine

**Files:**
- Create: `lib/verdict.ts`
- Test: `lib/verdict.test.ts`

**Interfaces:**
- Consumes: `CONFIG`, `Mode`, `Zone`, `angleDiff`
- Produces:
  - `type Risk = "safe" | "caution" | "danger"`
  - `type Verdict = Risk | "unknown"`
  - `type SourceId = "wind" | "current" | "alerts" | "flow"`
  - `type HourConditions = { windKnots: number | null; windFromDeg: number | null; currentSigned: number | null; currentTowardDeg: number | null; dischargeCfs: number | null; alerts: string[] | null; daylight: boolean }` (`currentSigned`: + flood, − ebb; `alerts`: null means unknown)
  - `type HourAssessment = { verdict: Verdict; opposing: boolean; missing: SourceId[]; reasons: string[] }`
  - `assessHour(c: HourConditions, zone: Zone, mode: Mode): HourAssessment`
  - `cardinal(deg: number): string`

**Rules, in order:**

1. **Missing sources:**
   - `wind` if `windKnots` or `windFromDeg` is null
   - `current` if `currentSigned` is null
   - `alerts` if `alerts` is null
   - `flow` if `zone.usesHudsonFlow` and `dischargeCfs` is null
2. **Banding:** `band(v, {caution, danger})` gives danger when `v > danger`, caution when `v ≥ caution`, otherwise safe.
3. **Opposing wind:**
   - True when `|currentSigned| ≥ 0.5` and `angleDiff(windFromDeg, currentTowardDeg) ≤ 45`.
   - When true, raise the wind band one level.
4. **Known danger:** any of the following makes the verdict `danger`, even if other sources are missing:
   - `!daylight`
   - `mode === "beginner" && zone.beginnerNoGo`
   - any alert listed in `CONFIG.noGoAlerts`
   - any present factor banded as danger
5. **Otherwise:** `unknown` if anything is missing, else the highest band.

**Reasons:** most severe first. Copy:
- `Outside daylight hours`
- `Hell Gate — Not for first-season paddlers`
- `{event} in effect`
- `Wind {k} kn from {cardinal}`, plus `, against the current` when opposing
- `Current {k.toFixed(1)} kn {ebb|flood}`
- `Hudson flow {n.toLocaleString("en-US")} cfs`

- [ ] **Step 1: Write the failing tests**

```ts
const hudson = zoneById("lower-hudson"), east = zoneById("lower-east"), gate = zoneById("hell-gate");
const ok: HourConditions = { windKnots: 5, windFromDeg: 180, currentSigned: 0.6, currentTowardDeg: 11, // S wind with the flood: not opposing
  dischargeCfs: 5000, alerts: [], daylight: true };
it("bands beginner and experienced thresholds", () => {
  expect(assessHour({ ...ok, windKnots: 8 }, hudson, "beginner").verdict).toBe("caution");
  expect(assessHour({ ...ok, windKnots: 12.5 }, hudson, "beginner").verdict).toBe("danger");
  expect(assessHour({ ...ok, windKnots: 12.5 }, hudson, "experienced").verdict).toBe("caution");
  expect(assessHour({ ...ok, currentSigned: -2.1, currentTowardDeg: 183 }, hudson, "beginner").verdict).toBe("danger");
  expect(assessHour({ ...ok, currentSigned: -2.1, currentTowardDeg: 183 }, hudson, "experienced").verdict).toBe("caution");
});
it("never returns safe when a source is missing", () => {
  for (const patch of [{ windKnots: null }, { currentSigned: null }, { alerts: null }, { dischargeCfs: null }])
    expect(assessHour({ ...ok, ...patch }, hudson, "beginner").verdict).toBe("unknown");
  expect(assessHour({ ...ok, dischargeCfs: null }, east, "beginner").verdict).toBe("safe"); // flow ignored on East River
  expect(assessHour({ ...ok, dischargeCfs: null }, hudson, "beginner").missing).toEqual(["flow"]);
});
it("keeps known danger even with missing data", () => {
  expect(assessHour({ ...ok, alerts: null, daylight: false }, hudson, "beginner").verdict).toBe("danger");
  expect(assessHour({ ...ok, windKnots: null }, gate, "beginner").verdict).toBe("danger");
  expect(assessHour({ ...ok, currentSigned: null, alerts: ["Small Craft Advisory"] }, hudson, "experienced").verdict).toBe("danger");
});
it("treats Hell Gate normally for experienced paddlers", () => expect(assessHour(ok, gate, "experienced").verdict).toBe("safe"));
it("detects wind against current from each zone's own heading", () => {
  // Hudson ebb flows toward 183°; a south wind (from 180°) opposes it.
  expect(assessHour({ ...ok, windKnots: 6, windFromDeg: 180, currentSigned: -0.8, currentTowardDeg: 183 }, hudson, "beginner"))
    .toMatchObject({ opposing: true, verdict: "caution" });
  // East River ebb flows toward 234° at the Brooklyn Bridge; a SW wind (225°) opposes it, a S wind (180°) does not.
  expect(assessHour({ ...ok, windFromDeg: 225, currentSigned: -0.8, currentTowardDeg: 234 }, east, "beginner").opposing).toBe(true);
  expect(assessHour({ ...ok, windFromDeg: 180, currentSigned: -0.8, currentTowardDeg: 234 }, east, "beginner").opposing).toBe(false);
  expect(assessHour({ ...ok, windFromDeg: 180, currentSigned: -0.3, currentTowardDeg: 183 }, hudson, "beginner").opposing).toBe(false);
});
it("writes reasons, most severe first", () => {
  expect(assessHour({ ...ok, windKnots: 14, windFromDeg: 180, currentSigned: -1.2, currentTowardDeg: 183 }, hudson, "beginner").reasons[0])
    .toBe("Wind 14 kn from S, against the current");
  expect(assessHour(ok, gate, "beginner").reasons[0]).toBe("Hell Gate — Not for first-season paddlers");
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run `npx vitest run lib/verdict.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `assessHour` and `cardinal` in `lib/verdict.ts`**

Follow the rules above. `cardinal` is today's 16-point helper from `kayak-chat.tsx`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run `npx vitest run lib/verdict.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: per-zone verdict engine with no-verdict on missing data"`

---

### Task 3: Upstream data sources

**Files:**
- Modify: `lib/sources.ts`. Add new functions only; the old ones are removed in Task 11.
- Test: `lib/sources-v2.test.ts` (merged into `lib/sources.test.ts` in Task 11)

**Interfaces:**
- Produces (each **throws** on a non-OK response or malformed payload):
  - `type CurrentPoint = { ts: string; signed: number; towardDeg: number }` (`ts` is NOAA's `"YYYY-MM-DD HH:MM"` local time)
  - `type WindPeriod = { ts: string; windKnots: number; fromDeg: number; direction: string }`
  - `type Alert = { event: string; endsAt: string | null }`
  - `fetchHourlyWind(p: LonLat): Promise<{ periods: WindPeriod[]; updatedAt: string }>`
    - NWS `points` (revalidate 86400), then `forecastHourly` (revalidate 1800)
    - `updatedAt` is `properties.updateTime`
    - wind speed is the **highest** number in `windSpeed` × 0.868976, rounded
  - `fetchCurrentSeries(station: string, date: string): Promise<CurrentPoint[]>`
    - same query as today plus `station`; `interval=60`; revalidate 43200
    - `towardDeg` is `meanEbbDir` when the speed is negative, otherwise `meanFloodDir`
  - `fetchDischarge(): Promise<{ cfs: number; at: string }>` (USGS `01335754`, parameter `00060`, last value; revalidate 900)
  - `fetchWaterTemp(): Promise<{ f: number; at: string }>` (NOAA `8518750` `water_temperature` latest; revalidate 1800)
  - `fetchAlerts(p: LonLat): Promise<Alert[]>` (NWS `alerts/active?point=lat,lon`; `endsAt` is `ends ?? expires`; revalidate 300)
  - `fetchRain48h(now: Date): Promise<number>`
    - Open-Meteo `forecast` with `hourly=precipitation&past_days=2&forecast_days=1&precipitation_unit=inch&timezone=America/New_York`
    - sums the 48 hourly values ending at the current NY hour; revalidate 1800
  - `fetchWindHistory(date: string): Promise<{ ts: string; knots: number; fromDeg: number }[]>` (NOAA `8530973` `wind`, `begin_date=end_date=date`; revalidate 86400)
- All requests send `User-Agent: PaddleAgent/0.2`. Use `fetch(url, { headers, next: { revalidate } })`.

- [ ] **Step 1: Write the failing tests**

Stub `fetch` with `vi.stubGlobal`, as `lib/sources.test.ts` does today.

```ts
it("maps NOAA current points with per-station flow-toward heading", async () => {
  stub({ current_predictions: { cp: [{ Time: "2026-10-26 07:00", Velocity_Major: -0.91, meanEbbDir: 241, meanFloodDir: 45 }, { Time: "2026-10-26 08:00", Velocity_Major: 1.2, meanEbbDir: 241, meanFloodDir: 45 }] } });
  expect(await fetchCurrentSeries("NYH1924", "2026-10-26")).toEqual([
    { ts: "2026-10-26 07:00", signed: -0.91, towardDeg: 241 }, { ts: "2026-10-26 08:00", signed: 1.2, towardDeg: 45 }]);
  const url = String(fetchMock.mock.calls[0][0]);
  for (const q of ["station=NYH1924", "begin_date=20261026", "end_date=20261026", "interval=60"]) expect(url).toContain(q);
});
it("takes the upper number of an NWS wind range", async () => {
  stubSequence({ properties: { forecastHourly: "https://x/hourly" } },
    { properties: { updateTime: "2026-10-26T18:20:57+00:00", periods: [{ startTime: "2026-10-26T18:00:00-04:00", windSpeed: "10 to 15 mph", windDirection: "SW" }] } });
  expect(await fetchHourlyWind([-73.94, 40.78])).toEqual({ updatedAt: "2026-10-26T18:20:57+00:00",
    periods: [{ ts: "2026-10-26T18:00:00-04:00", windKnots: 13, fromDeg: 225, direction: "SW" }] });
});
it("sums the last 48 hours of rain up to the current NY hour", async () => {
  const time = Array.from({ length: 72 }, (_, i) => `2026-10-${String(24 + Math.floor(i / 24)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00`);
  stub({ hourly: { time, precipitation: time.map((t) => (t === "2026-10-24T05:00" ? 9 : 0.01)) } });
  expect(await fetchRain48h(new Date("2026-10-26T22:30:00Z"))).toBeCloseTo(0.48, 2); // 18:30 NY: window 10-24 19:00 … 10-26 18:00
});
it("throws on HTTP errors and on missing data", async () => {
  stub({}, 500); await expect(fetchDischarge()).rejects.toThrow();
  stub({ error: { message: "No data was found" } }); await expect(fetchWaterTemp()).rejects.toThrow();
});
it("returns alert events with end times", async () => {
  stub({ features: [{ properties: { event: "Small Craft Advisory", ends: "2026-10-27T18:00:00-04:00", expires: "x" } }] });
  expect(await fetchAlerts([-74, 40.7])).toEqual([{ event: "Small Craft Advisory", endsAt: "2026-10-27T18:00:00-04:00" }]);
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run `npx vitest run lib/sources-v2.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the fetchers in `lib/sources.ts`**

Keep the existing functions untouched for now. The compass-to-degrees map moves here from `lib/windows.ts` as an exported `DIRECTION_DEGREES`. `lib/windows.ts` imports it from here until Task 11.

- [ ] **Step 4: Run the tests to make sure they pass**

Run `npx vitest run && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: zone-aware upstream fetchers (NWS, NOAA, USGS, Open-Meteo)"`

---

### Task 4: Outlook builder (pure)

**Files:**
- Create: `lib/outlook.ts`
- Test: `lib/outlook.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3
- Produces:
  - `type ZoneInputs = { zoneId: ZoneId; wind: { periods: WindPeriod[]; updatedAt: string } | null; current: CurrentPoint[] | null; alerts: Alert[] | null }`
  - `type OutlookInputs = { generatedAt: string; zones: ZoneInputs[]; discharge: { cfs: number; at: string } | null; water: { f: number; at: string } | null; rain48hIn: number | null }`
  - `type HourView = { key: string; ts: string; hourLabel: string; windKnots: number | null; windFromDeg: number | null; direction: string | null; current: number | null; currentTowardDeg: number | null; risk: Verdict; opposing: boolean; daylight: boolean; missing: SourceId[]; reasons: string[] }`
  - `type BestWindow = { kind: "green" | "leastRisky"; startKey: string; endKey: string; startLabel: string; endLabel: string } | { kind: "none" }` (`endLabel` is the hour **after** the last hour in the window)
  - `type CurrentNow = { nowSigned: number; caption: string; summary: CurrentSummary }`
  - `type CurrentSummary` has today's shape, from `lib/windows.ts`
  - `type ZoneOutlook = { zoneId: ZoneId; zoneName: string; mode: Mode; hours: HourView[]; strip: { label: "Today" | "Tomorrow"; hours: HourView[] }; best: BestWindow; currentNow: CurrentNow | null; gear: string | null; rainBadge: string | null; alerts: string[]; waterTempF: number | null; sun: { sunrise: string; sunset: string }; unavailable: string[]; updatedAt: string }`
  - `buildZoneOutlook(inputs: OutlookInputs, zoneId: ZoneId, mode: Mode, now: Date): ZoneOutlook`
  - `bestWindow(hours: HourView[]): BestWindow`
  - `gearLine(water: { f: number; at: string } | null, now: Date): string | null`
  - `bestWindowText(b: BestWindow, label: "Today" | "Tomorrow" = "Today"): { primary: string; secondary: string | null }`
  - `summarizeCurrent(points: CurrentPoint[], startKey: string, endKey: string): CurrentSummary` (today's algorithm, ported to `CurrentPoint`)
  - `const SOURCE_LABEL: Record<SourceId, string> = { wind: "NWS wind forecast", current: "NOAA currents", alerts: "NWS marine warnings", flow: "USGS river flow" }`

**Behaviour:**

- **`hours`:** 48 entries starting at the current NY hour, keyed by `hourKey`. On a repeated DST hour, keep the first entry.
  - Wind comes from the period with the same key. It's null if the zone has no wind data or `updatedAt` is more than 6 h before `now`.
  - Current comes from the point at `HH:00` for that key.
  - Discharge is used only if it is no more than 90 min old.
  - Alerts apply while `hour start < endsAt` (or always when `endsAt` is null). A null alerts list means unknown.
  - An hour is in daylight when `start ≥ sunrise` and `start + 60 min ≤ sunset`, using `sunTimes(date, zone.center)`.
- **`strip`:**
  - Before today's sunset: the daylight hours from now until sunset, labelled `Today`.
  - After sunset: tomorrow's daylight hours, labelled `Tomorrow`.
  - `best` is `bestWindow(strip.hours)`.
- **`bestWindow`:**
  - Pick the longest run of `safe` hours (a single hour counts), with ties going to the earliest. That gives `green`.
  - If there is none, pick the longest run of `caution` hours. That gives `leastRisky`.
  - If neither exists: `none`.
  - Never choose `danger` or `unknown` hours.
- **`bestWindowText`:**
  - `green` → `{ primary: "🟢 Best today: 3 PM–4 PM", secondary: null }`. With `label` Tomorrow, "today" becomes "tomorrow" in every string, including "No 🟢 window tomorrow".
  - `leastRisky` → `{ primary: "No 🟢 window today", secondary: "Least risky: 🟡 3 PM–5 PM" }`
  - `none` → `{ primary: "No 🟢 window today", secondary: null }`
- **`gearLine`:**
  - Water fresh (≤ 90 min old) and below 60 °F → `Water 52 °F — wetsuit or drysuit required`.
  - Water missing or stale and the NY month is one of `coldSeasonMonths` → the "assume cold" copy.
  - Otherwise null.
- **`rainBadge`:** the fixed copy when `rain48hIn ≥ 0.25`, otherwise null.
- **`unavailable`:** one `Couldn't reach {SOURCE_LABEL}` per source that is missing in any of the zone's hours, deduplicated. Water-temperature and rain failures add `Couldn't reach NOAA water temperature` and `Couldn't reach rainfall data`.
- **`currentNow`:** the signed value at the current hour. The caption copy is today's from `trigger/chat.ts` `buildChartData`.

- [ ] **Step 1: Write the failing tests**

Build a fixture helper `inputs(overrides?: { from?: string; windUpdatedAt?: string })` covering three NY days from `from` (default 2026-10-26) for all six zones:
- wind 5 kn from S (180°), with NWS-style ISO `ts` including the real EDT/EST offset
- current +0.6 kn toward 11° every hour
- discharge 5000 cfs and water 61 °F, both stamped at the test's `now`
- rain 0
- alerts `[]`

```ts
const NOW = new Date("2026-10-26T16:00:00Z"); // 12:00 NY, sunset ≈ 17:5x
it("starts at the current NY hour and covers 48 hours", () => {
  const o = buildZoneOutlook(inputs(), "lower-hudson", "beginner", NOW);
  expect(o.hours).toHaveLength(48); expect(o.hours[0].key).toBe("2026-10-26 12");
});
it("strip runs until sunset today, then switches to tomorrow (NY time, server in UTC)", () => {
  expect(buildZoneOutlook(inputs(), "lower-hudson", "beginner", NOW).strip).toMatchObject({ label: "Today" });
  const late = buildZoneOutlook(inputs(), "lower-hudson", "beginner", new Date("2026-10-27T01:30:00Z")); // 21:30 NY on the 26th
  expect(late.strip.label).toBe("Tomorrow"); expect(late.strip.hours[0].key.slice(0, 10)).toBe("2026-10-27");
});
it("counts a single green hour as a window and never suggests red", () => {
  const h = (risk: Verdict, key: string) => ({ risk, key, hourLabel: hourLabel(Number(key.slice(11))) }) as HourView;
  expect(bestWindow([h("caution", "2026-10-26 14"), h("safe", "2026-10-26 15"), h("caution", "2026-10-26 16")]))
    .toMatchObject({ kind: "green", startLabel: "3 PM", endLabel: "4 PM" });
  expect(bestWindowText(bestWindow([h("danger", "2026-10-26 14"), h("caution", "2026-10-26 15"), h("caution", "2026-10-26 16")])))
    .toEqual({ primary: "No 🟢 window today", secondary: "Least risky: 🟡 3 PM–5 PM" });
  expect(bestWindow([h("danger", "2026-10-26 14"), h("unknown", "2026-10-26 15")])).toEqual({ kind: "none" });
});
it("greys hours and names the source when wind is stale or a station failed", () => {
  const stale = buildZoneOutlook(inputs({ windUpdatedAt: "2026-10-26T08:00:00Z" }), "lower-hudson", "beginner", NOW);
  expect(stale.strip.hours.every((x) => x.risk === "unknown" || x.risk === "danger")).toBe(true);
  expect(stale.unavailable).toContain("Couldn't reach NWS wind forecast");
  const noCurrent = inputs(); noCurrent.zones.find((z) => z.zoneId === "lower-east")!.current = null;
  expect(buildZoneOutlook(noCurrent, "lower-east", "beginner", NOW).unavailable).toEqual(["Couldn't reach NOAA currents"]);
  expect(buildZoneOutlook(noCurrent, "lower-hudson", "beginner", NOW).unavailable).toEqual([]);
});
it("shows the gear line, including when the sensor is down in cold season", () => {
  expect(gearLine({ f: 52, at: "2026-11-10 11:50" }, new Date("2026-11-10T17:00:00Z"))).toBe("Water 52 °F — wetsuit or drysuit required");
  expect(gearLine(null, new Date("2026-01-10T17:00:00Z"))).toBe("Water temperature unavailable — assume cold, wetsuit or drysuit required");
  expect(gearLine(null, new Date("2026-08-10T16:00:00Z"))).toBeNull();
  expect(gearLine({ f: 70, at: "2026-08-10 11:50" }, new Date("2026-08-10T16:00:00Z"))).toBeNull();
});
it("survives the DST fall-back hour without duplicate keys", () => {
  const o = buildZoneOutlook(inputs({ from: "2026-10-31" }), "lower-hudson", "beginner", new Date("2026-11-01T03:00:00Z"));
  expect(new Set(o.hours.map((x) => x.key)).size).toBe(o.hours.length);
});
it("applies an alert only until it ends", () => {
  const i = inputs(); i.zones.find((z) => z.zoneId === "lower-hudson")!.alerts = [{ event: "Small Craft Advisory", endsAt: "2026-10-26T15:00:00-04:00" }];
  const o = buildZoneOutlook(i, "lower-hudson", "experienced", NOW);
  expect(o.hours.find((x) => x.key === "2026-10-26 14")!.risk).toBe("danger");
  expect(o.hours.find((x) => x.key === "2026-10-26 15")!.risk).toBe("safe");
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run `npx vitest run lib/outlook.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `lib/outlook.ts`**

Follow the behaviour above. `HourView.current` keeps the signed value for the existing current chart.

- [ ] **Step 4: Run the tests to make sure they pass**

Run `npx vitest run lib/outlook.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: pure zone outlook with best window, gear line and no-verdict hours"`

---

### Task 5: Outlook data loader and `GET /api/outlook`

**Files:**
- Create: `lib/outlook-data.ts`, `app/api/outlook/route.ts`
- Test: `lib/outlook-data.test.ts`

**Interfaces:**
- Consumes: the fetchers from Task 3, `OutlookInputs`
- Produces:
  - `getOutlookInputs(now: Date, dates?: string[]): Promise<OutlookInputs>`. `dates` defaults to the NY date for today plus the next two days.
  - `GET /api/outlook` returns `OutlookInputs` as JSON, with `export const dynamic = "force-dynamic"`. Caching happens per fetch, not per route.

Every call goes through `Promise.allSettled`, so a rejected fetch only nulls its own field:
- wind per zone
- current per zone and date (concatenated)
- alerts per zone
- discharge, water and rain once each

If one date of a zone's current series fails, the whole series for that zone is null. A partial series would silently leave holes in the hours.

- [ ] **Step 1: Write the failing test**

Mock the fetchers with `vi.mock("./sources", …)`.

```ts
it("isolates failures to the zone and source that failed", async () => {
  currentSeriesMock.mockImplementation(async (station: string) => { if (station === "NYH1924") throw new Error("down"); return series(); });
  windMock.mockResolvedValue({ periods: [], updatedAt: "2026-10-26T18:00:00Z" });
  dischargeMock.mockRejectedValue(new Error("usgs down"));
  const inputs = await getOutlookInputs(new Date("2026-10-26T16:00:00Z"));
  expect(inputs.zones.find((z) => z.zoneId === "hell-gate")!.current).toBeNull();
  expect(inputs.zones.find((z) => z.zoneId === "lower-hudson")!.current).not.toBeNull();
  expect(inputs.discharge).toBeNull();
  expect(currentSeriesMock).toHaveBeenCalledWith("NYH1927", "2026-10-28");
});
it("fetches the forecast for each zone's centre", async () => {
  await getOutlookInputs(new Date("2026-10-26T16:00:00Z"));
  expect(windMock).toHaveBeenCalledTimes(6); expect(windMock).toHaveBeenCalledWith(zoneById("hell-gate").center);
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run `npx vitest run lib/outlook-data.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the loader and route**

- [ ] **Step 4: Check it against live data**

- Run `npx vitest run lib/outlook-data.test.ts`. Expected: PASS.
- Run `npm run dev`, then `curl -s localhost:3000/api/outlook | head -c 600`. Expected: JSON with six `zones`, each with non-null `wind` and `current`.

- [ ] **Step 5: Commit**

`git commit -m "feat: /api/outlook with per-source failure isolation"`

---

### Task 6: Waterway graph, shortest path and place lookup

**Files:**
- Create: `lib/route/waterways.ts` (data), `lib/route/graph.ts`
- Modify: `lib/zones.ts` (fill in `Place.nodeId`)
- Test: `lib/route/graph.test.ts`

**Interfaces:**
- Consumes: `LonLat`, `ZONES`, `PLACES`, `zoneAt`, `distanceNm`, `lerp`
- Produces:
  - `type Bank = "manhattan" | "nj" | "brooklyn-queens"`
  - `type GNode = { id: string; lonLat: LonLat; bank: Bank }`
  - `type GEdge = { a: string; b: string; kind: "shore" | "crossing"; zoneId: ZoneId; nm: number }` (`zoneId` and `nm` are computed at load)
  - `NODES`, `EDGES`
  - `shortestPath(from: string, to: string, opts: { allowCrossings: boolean }): { nodes: string[]; edges: GEdge[] } | null` (Dijkstra by `nm`)
  - `findPlace(text: string): Place | null`. Case-insensitive match on name or alias. It strips "the" and "pier " spacing, and the longest alias wins.

**Data:**
- Near-shore polylines: about 100–150 m off each bank, nodes about every 0.3–0.5 nm.
  - Hudson: Manhattan bank and NJ bank.
  - East River: Manhattan bank and Brooklyn–Queens bank. Use Roosevelt Island's west channel on the Manhattan side and its east channel on the Queens side.
- The Manhattan Hudson and East River lines join around the Battery.
- Add 2–4 `crossing` edges per river at narrow points near launches. For example: Hoboken ↔ Manhattan, Brooklyn Bridge Park ↔ Manhattan, and LIC ↔ Manhattan.
- Every `Place.nodeId` points at its nearest node on its own bank.

- [ ] **Step 1: Write the failing tests**

```ts
it("keeps every edge on the water (inside some zone polygon)", () => {
  for (const e of EDGES) for (let t = 0; t <= 1; t += 0.05) {
    const p = lerp(node(e.a).lonLat, node(e.b).lonLat, t);
    expect(zoneAt(p), `${e.a}->${e.b} @${t.toFixed(2)}`).not.toBeNull();
  }
});
it("connects every place to every other place when crossings are allowed", () => {
  for (const a of PLACES) for (const b of PLACES) if (a !== b) expect(shortestPath(a.nodeId, b.nodeId, { allowCrossings: true })).not.toBeNull();
});
it("routes Hudson to East River around the Battery without crossings", () => {
  const r = shortestPath(findPlace("pier 40")!.nodeId, findPlace("brooklyn bridge")!.nodeId, { allowCrossings: false })!;
  expect(r.edges.some((e) => e.zoneId === "lower-hudson") && r.edges.some((e) => e.zoneId === "lower-east")).toBe(true);
});
it("needs a crossing from Hoboken to Manhattan", () => {
  expect(shortestPath(findPlace("hoboken")!.nodeId, findPlace("pier 40")!.nodeId, { allowCrossings: false })).toBeNull();
  expect(shortestPath(findPlace("hoboken")!.nodeId, findPlace("pier 40")!.nodeId, { allowCrossings: true })!.edges.some((e) => e.kind === "crossing")).toBe(true);
});
it("finds places by alias", () => { expect(findPlace("Pier40")?.id).toBe(findPlace("pier 40")?.id); expect(findPlace("the intrepid")?.kind).toBe("landmark"); });
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run `npx vitest run lib/route/graph.test.ts`. Expected: FAIL.

- [ ] **Step 3: Draw the data and implement**

Implement `lib/route/graph.ts` and draw `lib/route/waterways.ts`. If the on-water test fails, widen the zone polygon or move the node. Never skip the check.

- [ ] **Step 4: Run the tests to make sure they pass**

Run `npx vitest run lib/route lib/zones.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: waterway graph with shore and ferry-crossing edges"`

---

### Task 7: Route planner time model

**Files:**
- Create: `lib/route/plan.ts`
- Test: `lib/route/plan.test.ts`

**Interfaces:**
- Consumes: `shortestPath`, `findPlace`, `ZoneOutlook`, `CONFIG.route`, `wallMinutes`, `wallStamp`, `bearingDeg`, `angleDiff`
- Produces:
  - `type RouteRequest = { fromId: string; toId: string; depart: string; outAndBack?: boolean; turnaround?: string }` (stamps are `"YYYY-MM-DD HH:MM"` in NY time)
  - `type RouteSegment = { from: LonLat; to: LonLat; zoneId: ZoneId; kind: "shore" | "crossing"; risk: Verdict; at: string; groundKn: number; warning: string | null }`
  - `type RoutePlan = { request: RouteRequest; fromName: string; toName: string; distanceNm: number; durationMin: number; eta: string; worst: Verdict; segments: RouteSegment[]; blocked: "hell-gate" | "crossing" | null; warnings: string[]; suggestion: { depart: string; durationMin: number; allGreen: boolean } | null; caveat: string }`
  - `planRoute(req: RouteRequest, outlooks: Record<ZoneId, ZoneOutlook>, mode: Mode, now: Date): RoutePlan`
  - `summarizeRoute(p: RoutePlan): string`, a one-line text for the agent

**Algorithm:**

1. **Choosing the path:**
   - Beginner: try `allowCrossings: false` first. If that fails, use the crossing path for drawing only, with `blocked = "crossing"`.
   - Experienced: use `allowCrossings: true`.
   - Beginner and any edge in `hell-gate`: `blocked = "hell-gate"`.
2. **Walking it:** split edges into sub-steps of at most 15 minutes of travel.
   - For each sub-step at clock time `t`, look up the zone's `HourView` by `hourKey(wallStamp(t))`.
   - `along = |hour.current| × cos(hour.currentTowardDeg − bearing)`
   - `headwind = max(0, wind × cos(angleDiff(windFrom, bearing)))`.
   - `ground = paddle + along − 0.1 × headwind`.
   - If `ground < 0.5`: set the warning `You won't make headway here` and use 0.5 for the clock.
   - Stop after 8 hours of paddling and add the warning `Too long for one outing`.
3. **Segment risk:** the hour's `risk`. If the trip runs past the outlook horizon, the risk is `unknown`.
   - `blocked` paths: every segment is `danger`, with the warning `Not for first-season paddlers` (Hell Gate) or `Crosses a ferry lane — not for first-season paddlers`.
   - Experienced crossing segments: warning `Ferry lane — cross quickly, look both ways, cross at a right angle`.
4. **Out-and-back:** reverse the path. It starts at `max(arrival, turnaround)`.
5. **Suggested departure** (only when not blocked):
   - Try each departure every 30 min from the next half hour until today's sunset, and keep those that arrive by sunset with no `danger` or `unknown` segments.
   - Pick the shortest duration among all-🟢 candidates. If there are none, the shortest among those with no 🔴. Otherwise null.
6. **Caveat:** always `Planning estimate, not a guarantee of safe passage.`

- [ ] **Step 1: Write the failing tests**

Build outlooks from Task 4's `inputs` helper, with a controllable current and wind per zone.

```ts
it("is faster with the current than against it", () => {
  const ebb = outlooksWith({ signed: -1.5, towardDeg: 183 }); // flowing south
  const south = planRoute({ fromId: "pier-96", toId: "pier-40", depart: "2026-10-26 13:00" }, ebb, "experienced", NOW);
  const north = planRoute({ fromId: "pier-40", toId: "pier-96", depart: "2026-10-26 13:00" }, ebb, "experienced", NOW);
  expect(south.durationMin).toBeLessThan(north.durationMin);
  expect(south.distanceNm).toBeCloseTo(north.distanceNm, 5);
});
it("flags no headway when the current beats the paddler", () => {
  const p = planRoute({ fromId: "pier-40", toId: "pier-96", depart: "2026-10-26 13:00" }, outlooksWith({ signed: -3.2, towardDeg: 183 }), "beginner", NOW);
  expect(p.segments.some((s) => s.warning === "You won't make headway here")).toBe(true);
});
it("blocks Hell Gate and river crossings for beginners, with no suggestion", () => {
  const gate = planRoute({ fromId: launchIn("midtown-east"), toId: launchIn("hell-gate"), depart: "2026-10-26 13:00" }, calm(), "beginner", NOW);
  expect(gate).toMatchObject({ blocked: "hell-gate", worst: "danger", suggestion: null });
  const cross = planRoute({ fromId: "hoboken-cove", toId: "pier-40", depart: "2026-10-26 13:00" }, calm(), "beginner", NOW);
  expect(cross.blocked).toBe("crossing"); expect(cross.warnings).toContain("Crosses a ferry lane — not for first-season paddlers");
});
it("allows crossings for experienced paddlers with a ferry warning", () => {
  const p = planRoute({ fromId: "hoboken-cove", toId: "pier-40", depart: "2026-10-26 13:00" }, calm(), "experienced", NOW);
  expect(p.blocked).toBeNull();
  expect(p.segments.find((s) => s.kind === "crossing")!.warning).toBe("Ferry lane — cross quickly, look both ways, cross at a right angle");
});
it("suggests the quickest all-green departure before sunset", () => {
  const p = planRoute({ fromId: "pier-40", toId: "pier-96", depart: "2026-10-26 12:00" }, cautionUntil("2026-10-26 14"), "beginner", NOW);
  expect(p.suggestion).toMatchObject({ allGreen: true }); expect(p.suggestion!.depart >= "2026-10-26 14:00").toBe(true);
  expect(p.caveat).toBe("Planning estimate, not a guarantee of safe passage.");
});
it("returns on the reverse path after the turnaround", () => {
  const p = planRoute({ fromId: "pier-40", toId: "pier-96", depart: "2026-10-26 13:00", outAndBack: true, turnaround: "2026-10-26 15:00" }, calm(), "experienced", NOW);
  expect(p.segments.at(-1)!.to).toEqual(node(findPlace("pier 40")!.nodeId).lonLat); expect(p.eta > "2026-10-26 15:00").toBe(true);
});
```

Place ids (`pier-40`, `pier-96`, `hoboken-cove`) must match Task 1's data. Test helpers:
- `outlooksWith(cur)` sets every zone's hourly current to `cur` on Task 4's calm fixture.
- `calm()` is that fixture as-is.
- `cautionUntil(key)` gives every zone 9 kn wind before `key` (beginner 🟡) and calm wind after.
- `launchIn(zone)` picks the first launch in that zone.

- [ ] **Step 2: Run the tests to make sure they fail**

Run `npx vitest run lib/route/plan.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `planRoute` and `summarizeRoute` in `lib/route/plan.ts`**

- [ ] **Step 4: Run the tests to make sure they pass**

Run `npx vitest run lib/route lib/outlook.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: route planner with current/wind time model and beginner blocks"`

---

### Task 8: Trips, snapshots, rough-trip comparison, NY-time window resolver

**Files:**
- Create: `lib/trips.ts`, `lib/compare.ts`, `lib/trip-snapshot.ts`
- Modify: `lib/when.ts` to compute "today", weekdays and hours in NY time via `nyParts`. The `resolveWindow(question, now)` signature is unchanged.
- Test: `lib/trips.test.ts`, `lib/compare.test.ts`, `lib/trip-snapshot.test.ts`, `lib/when.test.ts` (update fixtures to UTC instants)

**Interfaces:**
- Produces:
  - `type TripSnapshot = { windKnots: number; windFromDeg: number | null; currentKnots: number; currentPhase: "ebb" | "flood"; verdict: Verdict }`
  - `type Trip = { tripId: string; route: string; zoneId: ZoneId; placeId: string | null; rating: "calm" | "moderate" | "rough"; notes: string; startedAt: string; mode: Mode; snapshot: TripSnapshot | null }`
  - `lib/trips.ts` (browser-safe):
    - `TRIPS_KEY = "paddle-agent:trips:v1"`, `ZONE_KEY = "paddle-agent:zone"`, `MODE_KEY = "paddle-agent:mode"`
    - `loadTrips(storage?: Storage | null): Trip[]`
    - `saveTrip(trip: Trip, storage?): Trip[]` (upsert by `tripId`)
    - `deleteTrip(id, storage?): Trip[]`
    - `loadPref<T>(key, isValid: (x: unknown) => x is T, fallback: T, storage?): T`
    - `savePref(key, value, storage?)`
    - `tripsSchema` (Zod array, max 50; used by `/api/chat`)
  - `lib/compare.ts`:
    - `roughTripStats(trips: Trip[]): { stats: { rough_trips: number; median_wind: number; avg_wind: number; median_current: number; avg_current: number }; trips: { trip_id: string; route: string; started_at: string; wind: number; current: number }[] }`. Field names are kept for today's `ComparisonCard`. It covers rough trips that have a snapshot, the latest 8.
    - `windowForecast(outlook: ZoneOutlook, target: TargetWindow): ForecastSummary`. Same `ForecastSummary` shape as today's `lib/forecast.ts`; built from `outlook.hours` in the target window.
  - `lib/trip-snapshot.ts`:
    - `tripSnapshot(zoneId: ZoneId, startedAt: string, mode: Mode, now: Date, inputs: OutlookInputs): Promise<TripSnapshot | null>`
    - Within ±60 min of now: use the outlook hour.
    - In the past: use `fetchWindHistory(date)`, taking the nearest record within 60 min, plus `fetchCurrentSeries(zone.currentStation, date)` at that hour. The verdict comes from `assessHour` with `alerts: []` and `dischargeCfs: null` on a copy of the zone with `usesHudsonFlow: false`, so it reflects wind and current only.
    - In the future, or when no data exists: null.

- [ ] **Step 1: Write the failing tests**

```ts
// trips
it("returns [] and defaults when storage is missing, throws, or holds junk", () => {
  expect(loadTrips(null)).toEqual([]);
  expect(loadTrips({ getItem: () => { throw new Error("SecurityError"); } } as unknown as Storage)).toEqual([]);
  expect(loadTrips(fakeStorage({ [TRIPS_KEY]: "{not json" }))).toEqual([]);
  expect(loadTrips(fakeStorage({ [TRIPS_KEY]: JSON.stringify([{ tripId: 1 }]) }))).toEqual([]);
  expect(loadPref(ZONE_KEY, isZoneId, "lower-hudson", fakeStorage({ [ZONE_KEY]: "atlantis" }))).toBe("lower-hudson");
});
it("upserts and deletes", () => {
  const s = fakeStorage({}); saveTrip(trip("a"), s); saveTrip({ ...trip("a"), notes: "x" }, s);
  expect(loadTrips(s)).toHaveLength(1); expect(deleteTrip("a", s)).toEqual([]);
});
// compare
it("computes medians over rough trips with snapshots only", () => {
  const r = roughTripStats([rough(10, 1), rough(14, 2), rough(20, 3), { ...rough(99, 9), snapshot: null }, { ...rough(1, 1), rating: "calm" }]);
  expect(r.stats).toMatchObject({ rough_trips: 3, median_wind: 14, median_current: 2 });
});
// when — NY time on a UTC server
it("resolves 'tomorrow' from New York's date, not UTC's", () => {
  expect(resolveWindow("tomorrow morning", new Date("2026-07-26T02:00:00Z"))).toMatchObject({ date: "2026-07-26", startHour: 6 }); // 22:00 NY on Jul 25
});
// snapshot
it("rejects future trips and builds past snapshots from history", async () => {
  expect(await tripSnapshot("lower-hudson", "2026-10-27 09:00", "beginner", NOW, inputs())).toBeNull();
  historyMock.mockResolvedValue([{ ts: "2026-10-20 10:06", knots: 9.4, fromDeg: 180 }]);
  seriesMock.mockResolvedValue([{ ts: "2026-10-20 10:00", signed: -1.1, towardDeg: 183 }]);
  expect(await tripSnapshot("lower-hudson", "2026-10-20 10:00", "beginner", NOW, inputs()))
    .toEqual({ windKnots: 9.4, windFromDeg: 180, currentKnots: 1.1, currentPhase: "ebb", verdict: "danger" }); // 9.4 kn + opposing → danger for beginner
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run `npx vitest run lib/trips.test.ts lib/compare.test.ts lib/trip-snapshot.test.ts lib/when.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

Rewrite the `when.test.ts` fixtures from `new Date(2026, 6, 21, 9, 0)` to `new Date("2026-07-21T13:00:00Z")` so they hold on any machine timezone.

- [ ] **Step 4: Run the tests to make sure they pass**

Run `npx vitest run`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: browser trip storage, snapshots and rough-trip comparison"`

---

### Task 9: Chat rate limiting and the counter store

**Files:**
- Create: `lib/rate-limit.ts`, `lib/counter-store.ts`
- Test: `lib/rate-limit.test.ts`

**Interfaces:**
- Produces:
  - `type CounterStore = { incr(key: string, ttlSeconds: number): Promise<number> }`
  - `type LimitResult = { ok: true } | { ok: false; status: 429 | 503; message: string }`
  - `checkChatLimits(store: CounterStore | null, ip: string, now: Date): Promise<LimitResult>`
  - `counterStoreFromEnv(env: NodeJS.ProcessEnv): CounterStore | null`
  - `memoryStore(): CounterStore` (development only)

**Limit logic:** fixed windows on NY time.
- Keys: `rl:ip:{ip}:h:{YYYY-MM-DD HH}` (TTL 3600), `rl:ip:{ip}:d:{YYYY-MM-DD}` (TTL 86400) and `rl:site:d:{YYYY-MM-DD}` (TTL 86400).
- Order:
  1. Increment the IP hour and IP day counters.
  2. If either is over its limit, deny without touching the site counter.
  3. Otherwise increment the site counter.
- **Messages:**
  - Hour limit: `You've reached the hourly limit for the guide (20 messages). Try again after {next hour label}.`
  - Day limit: `You've reached today's limit for the guide (50 messages). It resets at midnight.`
  - Site limit: `The guide is resting until tomorrow — it has answered its 500 questions for today. Conditions, the map and the route planner still work.`
- **Fail closed:** a null store or a throwing `incr` gives `{ ok: false, status: 503, message: "The guide is unavailable right now" }`.
- **`counterStoreFromEnv`:**
  - Returns the provider adapter when that provider's env vars are present.
  - Otherwise, when `NODE_ENV !== "production"`, returns `memoryStore()` and logs one warning.
  - Otherwise null.

- [ ] **Step 1: Provision the store**

Do this with the user's confirmation.
1. Load the `vercel:marketplace` skill and run its discovery for a free-tier, Redis-compatible key-value store.
2. Show the user the provider and the free plan, and get a yes before provisioning. Provisioning creates a resource on their Vercel account.
3. Provision it, connect it to the `paddle-agent` project, then run `vercel env pull .env.local`.
4. Install the provider's SDK.

- [ ] **Step 2: Write the failing tests**

Use a `fakeStore()` backed by a `Map`.

```ts
const NOW = new Date("2026-10-26T16:10:00Z");
it("allows 20 per hour per IP, then explains", async () => {
  const s = fakeStore(); for (let i = 0; i < 20; i++) expect((await checkChatLimits(s, "1.1.1.1", NOW)).ok).toBe(true);
  expect(await checkChatLimits(s, "1.1.1.1", NOW)).toMatchObject({ ok: false, status: 429, message: expect.stringContaining("hourly limit") });
  expect((await checkChatLimits(s, "2.2.2.2", NOW)).ok).toBe(true);
});
it("caps 50 per IP per day across hours", async () => {
  const s = fakeStore(); const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
  for (let i = 0; i < 50; i++) expect((await checkChatLimits(s, "1.1.1.1", at(Math.floor(i / 20)))).ok).toBe(true);
  expect(await checkChatLimits(s, "1.1.1.1", at(3))).toMatchObject({ ok: false, message: expect.stringContaining("today's limit") });
});
it("caps the whole site at 500 per day and does not count denied IPs against it", async () => {
  const s = fakeStore({ "rl:site:d:2026-10-26": 500 });
  expect(await checkChatLimits(s, "3.3.3.3", NOW)).toMatchObject({ ok: false, message: expect.stringContaining("resting until tomorrow") });
});
it("fails closed when the store is missing or throws", async () => {
  expect(await checkChatLimits(null, "1.1.1.1", NOW)).toEqual({ ok: false, status: 503, message: "The guide is unavailable right now" });
  expect((await checkChatLimits({ incr: async () => { throw new Error("down"); } }, "1.1.1.1", NOW)).ok).toBe(false);
});
it("uses memory only outside production", () => {
  expect(counterStoreFromEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeNull();
  expect(counterStoreFromEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).not.toBeNull();
});
```

- [ ] **Step 3: Run the tests to make sure they fail**

Run `npx vitest run lib/rate-limit.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement and run the tests**

Implement `lib/rate-limit.ts` and the provider adapter in `lib/counter-store.ts`: `incr`, then set the TTL when the result is 1. Run `npx vitest run lib/rate-limit.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

Commit without `.env.local`: `git commit -m "feat: chat rate limits on a free Marketplace counter store"`

---

### Task 10: Qwen agent server (`POST /api/chat`)

**Files:**
- Create: `lib/agent/types.ts`, `lib/agent/model.ts`, `lib/agent/prompt.ts`, `lib/agent/tools.ts`, `app/api/chat/route.ts`
- Test: `lib/agent/tools.test.ts`, `app/api/chat/route.test.ts`

**Interfaces:**
- Consumes: `getOutlookInputs`, `buildZoneOutlook`, `bestWindowText`, `planRoute`, `summarizeRoute`, `findPlace`, `tripSnapshot`, `roughTripStats`, `windowForecast`, `resolveWindow`, `checkChatLimits`, `counterStoreFromEnv`, `tripsSchema`
- Produces:
  - `lib/agent/types.ts`:
    - `PaddleBriefingData = { zoneId: ZoneId; zoneName: string; mode: Mode; label: string; hours: HourView[]; best: BestWindow; bestText: { primary: string; secondary: string | null }; currentNow: CurrentNow | null; gear: string | null; rainBadge: string | null; alerts: string[]; unavailable: string[] }`
    - `PaddleComparisonData` (today's shape)
    - `PaddleChatDataTypes = { "paddle-briefing": PaddleBriefingData; "paddle-route": RoutePlan; "paddle-trip": Trip; "paddle-comparison": PaddleComparisonData }`
    - `PaddleChatUIMessage = UIMessage<unknown, PaddleChatDataTypes>`
    - `PaddleDataPart = { [K in keyof PaddleChatDataTypes]: { type: `data-${K}`; data: PaddleChatDataTypes[K] } }[keyof PaddleChatDataTypes]`
    - `chatRequestSchema` (Zod): `{ messages: UIMessage[] (min 1); zoneId: ZoneId; mode: Mode; trips: tripsSchema }`
  - `lib/agent/model.ts`: `qwenModel()`. Uses `createOpenAICompatible({ name: "qwen", baseURL: process.env.QWEN_BASE_URL ?? DEFAULT, apiKey: process.env.QWEN_API_KEY })` and returns `.chatModel(process.env.QWEN_MODEL ?? "qwen-plus")`.
  - `lib/agent/prompt.ts`: `systemPrompt(zone: Zone, mode: Mode, now: Date): string`
  - `lib/agent/tools.ts`: `createPaddleTools(ctx: { write: (part: PaddleDataPart) => void; zoneId: ZoneId; mode: Mode; trips: Trip[]; inputs: OutlookInputs; now: Date; loadInputs: (dates: string[]) => Promise<OutlookInputs> })`
  - `POST /api/chat`

**Tools** (Zod input schemas; `zone` is optional and defaults to `ctx.zoneId`; every tool writes its data part and returns compact JSON for the model):
- `get_conditions({ zone? })`: briefing over `strip.hours`, labelled `Today` or `Tomorrow`.
- `find_paddle_windows({ zone?, hours = 48 })`: briefing over the first `hours` entries, labelled `Next {hours} hours`.
- `plan_route({ from, to, depart?, outAndBack?, turnaround? })`:
  - `findPlace` on both ends. If either is unknown, return `{ error, knownPlaces: PLACES.map(p => p.name) }`.
  - `depart` defaults to the next whole NY hour.
  - Writes `data-paddle-route` and returns `summarizeRoute`.
- `log_trip({ route, rating, notes?, started_at?, zone? })`:
  - `zone` defaults to the zone of `findPlace(route)` if found, else `ctx.zoneId`.
  - Snapshot via `tripSnapshot`. Writes `data-paddle-trip`.
  - The server stores nothing.
- `compare_rough_trips({ when = "Sunday morning", zone? })`:
  - `resolveWindow(when, now)`. Call `loadInputs([target.date])` when the target date isn't in `inputs`.
  - Uses `windowForecast` and `roughTripStats(ctx.trips)`. Writes `data-paddle-comparison`.

**System prompt:** keep today's text from `trigger/chat.ts` (verdict line, WHY IT MATTERS / BEST MOVE / NEXT ACTION, under 160 words, never invent numbers, the log and compare instructions) with these changes:
- "Hoboken/NY Harbor" becomes `${zone.name}`.
- Add a line stating the mode and that thresholds are for `${mode === "beginner" ? "a first-season paddler" : "an experienced paddler"}`.
- Add the rule: if `get_conditions` returns a gear line, include it verbatim in WHY IT MATTERS.
- Add the rule: for routes, call `plan_route`, state distance, time and the suggested departure, and always end with `Planning estimate, not a guarantee of safe passage.`
- Add the rule: never recommend Hell Gate or a river crossing to a beginner.
- Add the rule: if a tool reports `unavailable` sources, say which source failed, and give no verdict for those hours.
- The GO line still mentions Hoboken Cove Community Boathouse **only** when the zone is a Hudson zone.
- Include today's NY date and time so "today" and "Sunday" resolve correctly.

**Route handler flow:**
1. **Parse.** JSON parse failure → 400 `Bad request`. Schema failure → 400 with the first issue.
2. **Message length.** The last user message's text must be ≤ 500 characters, otherwise 400 `Please keep questions under 500 characters.`
3. **Rate limit.** `checkChatLimits(counterStoreFromEnv(process.env), ip, now)`, where `ip` is `x-real-ip`, else the first `x-forwarded-for` entry, else `"unknown"`. If not ok, return `new Response(message, { status })`.
4. **Load data.** `inputs = await getOutlookInputs(now)`.
5. **Stream.** Use `createUIMessageStream<PaddleChatUIMessage>`. In `execute({ writer })`:
   - `streamText({ model: qwenModel(), system, messages: await convertToModelMessages(messages.slice(-12)), tools: createPaddleTools({ write: (p) => writer.write(p), … }), stopWhen: stepCountIs(4), maxOutputTokens: 1200 })`
   - `writer.merge(result.toUIMessageStream())`
6. **Respond.** Return `createUIMessageStreamResponse({ stream })`.

- [ ] **Step 1: Add the provider package**

Run `npm install @ai-sdk/openai-compatible@^2`.

- [ ] **Step 2: Write the failing tests**

```ts
// tools.test.ts — fake writer, fixture inputs from Task 4
it("get_conditions writes a briefing for the selected zone and mode", async () => {
  const parts: any[] = []; const tools = createPaddleTools({ ...ctx, write: (p) => parts.push(p) });
  const out = await tools.get_conditions.execute!({}, { toolCallId: "t", messages: [] });
  expect(parts[0]).toMatchObject({ type: "data-paddle-briefing", data: { zoneId: "lower-hudson", mode: "beginner" } });
  expect(out).toHaveProperty("bestText");
});
it("plan_route returns known places for an unknown destination", async () => {
  const out: any = await createPaddleTools(ctx).plan_route.execute!({ from: "pier 40", to: "narnia" }, { toolCallId: "t", messages: [] });
  expect(out.error).toBeTruthy(); expect(out.knownPlaces).toContain(findPlace("pier 40")!.name);
});
it("log_trip writes the trip for the browser to keep and infers the zone from the route", async () => {
  const parts: any[] = []; await createPaddleTools({ ...ctx, zoneId: "lower-east", write: (p) => parts.push(p) })
    .log_trip.execute!({ route: "Pier 40", rating: "rough" }, { toolCallId: "t", messages: [] });
  expect(parts[0]).toMatchObject({ type: "data-paddle-trip", data: { rating: "rough", zoneId: findPlace("pier 40")!.zoneId } });
});
it("compare_rough_trips uses only the trips sent with the request", async () => {
  const parts: any[] = [];
  await createPaddleTools({ ...ctx, trips: [roughTrip(10, 1), roughTrip(14, 2)], write: (p) => parts.push(p) })
    .compare_rough_trips.execute!({ when: "tomorrow morning" }, { toolCallId: "t", messages: [] });
  expect(parts[0]).toMatchObject({ type: "data-paddle-comparison", data: { rough: { rough_trips: 2, median_wind: 12 } } });
});

// route.test.ts — mock lib/agent/model (never call Qwen), lib/outlook-data and lib/rate-limit
it.each([
  ["non-JSON", "not json"],
  ["unknown zone", JSON.stringify({ messages: [userMsg("hi")], zoneId: "atlantis", mode: "beginner", trips: [] })],
  ["too many trips", JSON.stringify({ messages: [userMsg("hi")], zoneId: "lower-hudson", mode: "beginner", trips: Array(51).fill(trip) })],
  ["long message", JSON.stringify({ messages: [userMsg("x".repeat(501))], zoneId: "lower-hudson", mode: "beginner", trips: [] })],
])("rejects %s with 400 before the model or limiter runs", async (_name, body) => {
  const res = await POST(new Request("http://x/api/chat", { method: "POST", body }));
  expect(res.status).toBe(400); expect(qwenModelMock).not.toHaveBeenCalled(); expect(limitMock).not.toHaveBeenCalled();
});
it("returns the limiter's message and status as plain text", async () => {
  limitMock.mockResolvedValue({ ok: false, status: 429, message: "You've reached the hourly limit…" });
  const res = await POST(validRequest()); expect(res.status).toBe(429); expect(await res.text()).toMatch(/hourly limit/);
});
```

- [ ] **Step 3: Run the tests to make sure they fail**

Run `npx vitest run lib/agent app/api/chat`. Expected: FAIL.

- [ ] **Step 4: Implement and run the tests**

Implement the five files, then run `npx vitest run && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Check it against real Qwen**

Put `QWEN_API_KEY` in `.env.local`, start `npm run dev`, and run:

```bash
curl -N localhost:3000/api/chat -H 'content-type: application/json' -d '{"zoneId":"lower-hudson","mode":"beginner","trips":[],"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Can I paddle now?"}]}]}'
```

Expected: an SSE stream containing `"type":"data-paddle-briefing"` and text starting with 🟢, 🟡 or 🔴. If the model answers without calling the tool, tighten the prompt or set `QWEN_MODEL` to a stronger Qwen model, and note the choice in the commit message.

- [ ] **Step 6: Commit**

`git commit -m "feat: Qwen chat endpoint with zone-aware tools and request validation"`

---

### Task 11: Port the chat UI and remove Trigger.dev, ClickHouse and OpenAI

**Files:**
- Modify: `app/components/kayak-chat.tsx` → rename to `app/components/chat-sheet.tsx`, `package.json`, `app/page.tsx` (temporarily renders only `<ChatSheet open zoneId="lower-hudson" mode="beginner" trips={[]} …/>` with no-op callbacks)
- Create: `scripts/smoke.ts`
- Delete: `trigger/`, `trigger.config.ts`, `app/actions.ts`, `app/api/conditions/`, `lib/clickhouse.ts`, `db/`, `lib/safety.ts`, `lib/windows.ts`, `lib/briefing.ts`, `lib/forecast.ts`, `lib/chat-types.ts`, `lib/briefing.test.ts`, `lib/windows.test.ts`, `scripts/ingest-once.ts`, `scripts/smoke-*.ts`, `scripts/verify-current.ts`, and the old fetchers in `lib/sources.ts` with their tests (merge `sources-v2.test.ts` into `sources.test.ts`)

**Interfaces:**
- Consumes: `PaddleChatUIMessage`, `PaddleBriefingData`, `RoutePlan`, `Trip`, `HourView`, `BestWindow`
- Produces: `ChatSheet({ open, onClose, zoneId, mode, trips, onTrip, onRoute, initialQuestion? }: { open: boolean; onClose: () => void; zoneId: ZoneId; mode: Mode; trips: Trip[]; onTrip: (t: Trip) => void; onRoute: (p: RoutePlan) => void; initialQuestion?: string | null })`

**Porting the chat:**
- **Transport:**
  - `useChat<PaddleChatUIMessage>({ transport: new DefaultChatTransport({ api: "/api/chat", prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, messages: messages.slice(-12) } }) }), onData })`
  - Send with `sendMessage({ text }, { body: { zoneId, mode, trips } })`.
  - `onData` calls `onTrip(part.data)` for `data-paddle-trip` and `onRoute(part.data)` for `data-paddle-route`.
- **Keep:** `parseReply`, `AssistantReply`, `CardReply`, `PaddleTimeline`, `CurrentTimeline`, `TripSavedCard`, `ComparisonCard`.
  - Retype them to `HourView` and `BestWindow`.
  - `PaddleTimeline` colours `unknown` hours grey (`#c9d3d9`), with the tooltip "No verdict".
- **Add:** `RouteReplyCard`, which shows distance, time and suggested departure, plus a "Show on map" button that calls `onRoute`.
- **Remove:** the verdict hero, gauges and `/api/conditions` fetch. The home screen replaces them in Task 12.
- **Prompts:** suggested prompts become "Can I paddle now?", "Best window today", "Plan Pier 40 to the Intrepid", and "How does Sunday compare with my rough trips?"
- **Errors:** show the response text (the limiter's message) instead of a raw JSON error.

**Packages:**
- Remove `@trigger.dev/sdk`, `trigger.dev`, `@clickhouse/client` and `@ai-sdk/openai`.
- Remove the `dev:trigger`, `ingest:once` and `smoke:*` scripts.
- Add `"smoke": "node --env-file-if-exists=.env.local --import tsx scripts/smoke.ts"`.

**`scripts/smoke.ts`:**
- Posts four requests to `${SMOKE_URL ?? "http://localhost:3000"}/api/chat` and parses the `data:` SSE lines.
- It fails (exit code 1) unless:
  1. "Can I paddle now?" produces `data-paddle-briefing`
  2. "Log today's Pier 40 paddle as rough." produces `data-paddle-trip` with `rating: "rough"`
  3. "How does Sunday morning compare with my rough trips?", sent with two rough trips in `trips`, produces `data-paddle-comparison` with `rough_trips: 2`
  4. "Plan Pier 40 to the Intrepid at 3pm" produces `data-paddle-route`
- Print each case's verdict line or summary.

- [ ] **Step 1: Delete and port**

Make the deletions and package edits, run `npm install`, and port the component.

- [ ] **Step 2: Typecheck, test and build**

Run `npm run typecheck && npm test && npm run build`. Expected: all pass. `grep -rn "trigger\|clickhouse\|@ai-sdk/openai\"" --include=*.ts --include=*.tsx --include=package.json . | grep -v node_modules` prints nothing.

- [ ] **Step 3: Smoke test against the dev server**

With `npm run dev` running, run `npm run smoke`. Expected: four `PASS` lines. Each one proves the Qwen model calls the right tool.

- [ ] **Step 4: Commit**

`git commit -m "refactor: chat on /api/chat with Qwen; remove Trigger.dev, ClickHouse and OpenAI"`

---

### Task 12: Home screen (layout A) and My trips

**Files:**
- Create: `app/components/home.tsx` (client: state and composition), `app/components/verdict-card.tsx`, `app/components/hour-strip.tsx`, `app/components/top-bar.tsx`, `app/components/trips-sheet.tsx`
- Modify: `app/page.tsx`, `app/layout.tsx` (metadata), `app/globals.css`

**Interfaces:**
- Consumes: `/api/outlook`, `buildZoneOutlook`, `bestWindowText`, `loadTrips`, `saveTrip`, `deleteTrip`, `loadPref`, `savePref`, `nearestZone`, `ChatSheet`
- Produces: `Home()` with this state:
  - `mode`, `zoneId`, `selectedKey` (an hour key), `inputs`, `trips`
  - `sheet: "chat" | "map" | "trips" | null`
  - `activeRoute: RoutePlan | null`, consumed by Task 13–14

**Layout** (match `.superpowers/brainstorm/*/content/layout.html`, option A):
1. **Top bar:** brand, a Beginner/Experienced segmented switch (persisted under `MODE_KEY`; **defaults to Beginner**), and a zone picker (six zones plus "📍 Near me").
   - "Near me" calls `navigator.geolocation` once, then `nearestZone`. If the user denies or it errors, keep the current zone and show "Location unavailable".
   - Also shows "Updated N min ago" from `inputs.generatedAt`.
2. **Alert banner:** red, shown when `outlook.alerts.length`. Lists the events.
3. **Verdict card for `selectedKey`** (defaults to the current hour):
   - The word and colour: 🟢 GO / 🟡 CAUTION / 🔴 NO-GO / grey "No verdict".
   - The first two `reasons`.
   - Grey state: the `unavailable` lines instead of the reasons.
   - `bestText.primary`, and `secondary` when present.
   - The `gear` line in bold when present.
4. **Hour strip:** `outlook.strip`, labelled Today or Tomorrow. Tapping an hour sets `selectedKey`; tapping it again returns to now.
5. **Chips** for the selected hour:
   - 💨 `{k} kn {dir}`
   - 🌊 `{k} kn {ebb|flood}`, then `· turns {phase} {time}`
   - 🌡 `{f} °F`, or "unavailable"
   - 💧 rain badge or "No recent rain"
   - 🌅 sunset time
6. **Map preview slot:** a placeholder `<button>` until Task 13. It opens `sheet = "map"`.
7. **Bottom bar:** a pinned "💬 Ask the guide…" bar that opens `ChatSheet`, plus a "My trips" button that opens `TripsSheet`. `TripsSheet` lists trips (newest first) showing rating, route, date and snapshot wind and current, with delete.

**Below the fold:** the Longfellow verse, the Hoboken Cove Community Boathouse note (existing copy), and a new colophon: `USGS + NOAA + NWS → your browser → Qwen guide`.

**Metadata:**
- title: `Paddle Agent — Hudson & East River paddling conditions`
- description: `Live wind, current and warnings for NYC's Hudson and East River, turned into one honest answer for first-season paddlers: should you launch?`

**Data refresh:** fetch `/api/outlook` on mount and every 10 minutes while the tab is visible.

**Rendering rules:**
- Recompute the outlook with `useMemo` when `inputs`, `zoneId`, `mode` or the minute changes.
- Mode and zone switches must not refetch.
- Until `inputs` arrives, the card shows a skeleton. It must not show a verdict.

**Styling:**
- Below 900 px: single column, with the chat as a full-height bottom sheet.
- From 900 px: a two-column grid. The left column (map) is 58% wide; the right column holds the verdict card, strip, chips, then the chat inline.
- Respect `prefers-reduced-motion` for the existing animations.

- [ ] **Step 1: Build the components**

Build the components and wire them in `app/page.tsx`.

- [ ] **Step 2: Check types, tests and build**

Run `npm run typecheck && npm test && npm run build`. Expected: PASS.

- [ ] **Step 3: Check it on a phone-sized screen**

Use the `run` skill. Open `localhost:3000` at 390×844. Check each of these:
- A verdict appears within about 3 s.
- Switching to Experienced changes colours without a network request (check the Network tab).
- Switching to Hell Gate in Beginner mode shows 🔴 with "Hell Gate — Not for first-season paddlers".
- Logging a trip through the chat makes it appear in My trips and survive a reload.
- With localStorage blocked (a private window), the page still renders.
- At 1280 px wide the layout has two columns.

Take screenshots of both widths.

- [ ] **Step 4: Commit**

`git commit -m "feat: verdict-first home screen with hour strip, chips and My trips"`

---

### Task 13: Full map with time slider

**Files:**
- Create: `app/components/paddle-map.tsx` (client-only), `app/components/map-sheet.tsx`
- Modify: `app/components/home.tsx` (preview and sheet), `app/globals.css`

**Interfaces:**
- Consumes: `ZONES`, `PLACES`, `ZoneOutlook` for all six zones (via `buildZoneOutlook` per zone), `selectedKey`, `trips`, `activeRoute`
- Produces:
  - `PaddleMap(props: { outlooks: Record<ZoneId, ZoneOutlook>; selectedKey: string; zoneId: ZoneId; trips: Trip[]; route: RoutePlan | null; interactive: boolean; onPickZone?: (z: ZoneId) => void; onPlanFrom?: (placeId: string) => void })`
  - `MapSheet` (full screen on phone, left column on desktop) containing `PaddleMap`, a 48-hour range slider bound to `selectedKey` with the same keys as `outlook.hours`, and the route panel slot used in Task 14

**Map:**
- `npm install maplibre-gl`. Load it with `next/dynamic(() => import("./paddle-map"), { ssr: false })` and import `maplibre-gl/dist/maplibre-gl.css`.
- Style: `https://tiles.openfreemap.org/styles/positron` (free, no key). Initial bounds fit all zone polygons.
- **Zones:** a GeoJSON fill layer with `fill-color` from `["get","color"]`. Colours are green `#1e9e57`, caution `#dd8a00`, danger `#e03e3e` and unknown `#c9d3d9`, at opacity 0.45, for each zone's verdict at `selectedKey`. The selected zone gets a 2 px outline.
- **Pins:**
  - Launches are white circles with a navy stroke. Landmarks are small navy dots.
  - Tapping a launch opens a popup with its name, zone, verdict word at `selectedKey`, a "Set as my zone" button (`onPickZone`) and a "Plan a route from here" button (`onPlanFrom`).
  - Trip pins sit at `placeId`'s coordinates, or at the zone centre (offset slightly for each additional trip), coloured by rating: calm green, moderate amber, rough red.
- **Arrows:** one HTML-marker current arrow per zone, at the zone centre, rotated to `currentTowardDeg`, with "1.4 kn" as its label. One wind arrow for the selected zone, rotated to `windFromDeg + 180`.
- **Preview:** `interactive={false}`, about 120 px tall, mounted only after the verdict card renders.

- [ ] **Step 1: Build the map**

Build `PaddleMap` and `MapSheet`, then replace the placeholder preview.

- [ ] **Step 2: Check types and build**

Run `npm run typecheck && npm run build`. Expected: PASS. The first-load JS for `/` must not include maplibre: check that `next build` output shows it in a separate chunk.

- [ ] **Step 3: Check it in the browser**

Using the `run` skill:
- Dragging the slider recolours zones and rotates the arrows.
- "Set as my zone" updates the home card.
- At night hours every zone is red.
- Offline tiles fail gracefully: the zones still draw over a blank background.

Take a screenshot.

- [ ] **Step 4: Commit**

`git commit -m "feat: zone-coloured map with launches, arrows, trips and 48h slider"`

---

### Task 14: Route planner panel and chat → map integration

**Files:**
- Create: `app/components/route-panel.tsx`
- Modify: `app/components/map-sheet.tsx`, `app/components/paddle-map.tsx` (route layer), `app/components/home.tsx`

**Interfaces:**
- Consumes: `planRoute`, `PLACES`, `RoutePlan`, `onRoute` from `ChatSheet`
- Produces: `RoutePanel({ outlooks, mode, initialFrom, onPlan }: { outlooks: Record<ZoneId, ZoneOutlook>; mode: Mode; initialFrom?: string; onPlan: (p: RoutePlan | null) => void })`

**Route panel:**
- **Inputs:**
  - From: launches only.
  - To: launches and landmarks.
  - Depart: a select of the next 48 outlook hours plus `:30` steps; defaults to the next whole hour.
  - An "Out and back" checkbox, with a turnaround select when checked.
- **Planning:** recompute with `planRoute` client-side on every change. No network call.
- **Result:**
  - Distance in nm (1 decimal), duration (`1 h 10 min`), ETA, and the worst verdict word.
  - The warnings list.
  - The suggestion as "Leave 2:30 PM — 1 h 10 min, all 🟢", with an "Use this time" button.
  - The caveat line, always visible.
- **Route layer:** a GeoJSON line layer, 4 px, coloured per segment by `risk`. Crossing segments are dashed. Blocked plans draw everything red and show the blocking message in bold.

**Chat integration:** `ChatSheet.onRoute` sets `activeRoute` and opens the map sheet. The phone closes the chat sheet; desktop keeps both visible. It also pre-fills the panel from `plan.request`.

- [ ] **Step 1: Build and wire**

Build the panel and route layer, then wire the integration.

- [ ] **Step 2: Check types, tests and build**

Run `npm run typecheck && npm test && npm run build`. Expected: PASS.

- [ ] **Step 3: Check it in the browser**

Using the `run` skill:
- Plan Pier 40 → Intrepid and get a route along the Manhattan shore with a time estimate.
- Hoboken → Pier 40 in Beginner mode shows red with "Crosses a ferry lane — not for first-season paddlers" and no suggestion. In Experienced mode the crossing is dashed with the ferry warning.
- Asking the chat "Plan Pier 40 to the Intrepid at 3pm" opens the map with the route drawn.

Take screenshots.

- [ ] **Step 4: Commit**

`git commit -m "feat: route planner panel and chat-to-map routes"`

---

### Task 15: Docs, environment, preview deploy and verification

**Files:**
- Modify: `README.md`, `.env.example`, `.gitignore` (add `.superpowers/` and `.env.local`), `docs/superpowers/specs/2026-10-27-public-demo-design.md` (status line)

**README:**
- Rewrite "How it works": USGS, NOAA, NWS and Open-Meteo → `/api/outlook` (cached fetches) → the browser's verdict engine. Chat: browser → `/api/chat` (rate-limited) → Qwen with tools.
- Update the stack list and prerequisites (Node 22+, a Qwen API key, the free counter store).
- Setup is `npm install`, `.env.local`, `npm run dev`.
- Keep the env table to the three `QWEN_*` vars plus the store's.
- Commands: `test`, `typecheck`, `build`, `smoke`.
- Keep the Safety section and add: "Thresholds are draft values for first-season paddlers; see `lib/config.ts`."

**`.env.example`:** only `QWEN_API_KEY=`, `QWEN_BASE_URL=` (commented default), `QWEN_MODEL=` (commented default), and a comment that the store's variables come from `vercel env pull`.

- [ ] **Step 1: Write the docs**

Update the docs and set the spec's `Status:` to `Approved — implemented on branch public-demo`.

- [ ] **Step 2: Clean up Vercel env vars and deploy a preview**

Confirm with the user before changing anything.
- **Add** `QWEN_API_KEY` (and `QWEN_BASE_URL` / `QWEN_MODEL` if not defaults) to Preview and Production with `vercel env add`.
- **Remove** stale `TRIGGER_*`, `CLICKHOUSE_*`, `OPENAI_API_KEY`, `RESEND_API_KEY` and `ALERT_FROM_EMAIL` with `vercel env rm`. List them first and show the user.
- **Deploy** a preview with the `vercel:deploy` skill (no `prod`).

- [ ] **Step 3: Verify the preview**

Run `SMOKE_URL=<preview-url> npm run smoke`. Expected: four PASS lines. Then repeat Task 12's phone and desktop checks on the preview URL.

- [ ] **Step 4: Check the rate limit on the preview**

Send 21 chat requests from one IP within an hour. Expected: the 21st returns 429 with the hourly-limit message. Then confirm the counter keys exist in the store's dashboard.

- [ ] **Step 5: Commit and hand off**

`git commit -m "docs: README and env for the public demo"`.

Report the preview URL and screenshots to the user. **Do not promote to production or merge to `main` without the user's explicit go-ahead.** Use superpowers:finishing-a-development-branch.
