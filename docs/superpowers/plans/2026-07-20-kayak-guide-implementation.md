# KayakGuide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build KayakGuide — a Trigger.dev `chat.agent()` chat app for Hudson River paddlers, grounded in 16 years of USGS/NOAA data in ClickHouse, with safety verdicts, paddle-window timelines, agent-built dashboards, trip logging, and condition watches with email alerts.

**Architecture:** Trigger.dev tasks handle ingestion (cron) and the conversation (`chat.agent()`); ClickHouse Cloud is the only database (OLAP sensor time-series + OLTP trips/watches); a Next.js App Router frontend talks to the agent via `useChat` + `useTriggerChatTransport` (no chat API routes). Pure functions (safety verdict, window finder, round-trip planner, parsers) are unit-tested with vitest; agent tools are thin wrappers over named ClickHouse queries.

**Tech Stack:** Next.js (App Router, TypeScript, Tailwind), `@trigger.dev/sdk` ^4.5.4, AI SDK v5 (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`), Claude Sonnet (`claude-sonnet-4-6`), `@clickhouse/client`, Resend, Recharts, vitest.

**Spec:** `docs/superpowers/specs/2026-07-19-kayak-paddler-agent-plan.md` (same repo).

## Global Constraints

- Hackathon: ClickHouse × Trigger.dev AI Hackathon 2026; build window July 17–23; submission deadline July 23 midnight AoE. All code written inside the window. MIT license.
- ClickHouse is the primary and **only** database.
- Trigger.dev v4.5+ orchestrates the conversation (`chat.agent()`) and all background work.
- Stations (exact IDs, used everywhere): USGS `01335754` (Hudson above Lock 1, Waterford NY) and `01377260` (Hudson at Pier 40, NY); NOAA tides `8518750` (The Battery); NOAA currents `NYH1927_13` (Hudson River Entrance, bin 13); NOAA wind `8530973` (Robbins Reef); NWS point forecast `40.7076,-74.0253`.
- Safety thresholds (verbatim from spec): discharge cfs `< 15,000` safe · `15,000–25,000` caution · `> 25,000` danger; current knots `< 1.5` safe · `1.5–2.5` caution · `> 2.5` danger; sustained wind knots `< 10` safe · `10–15` caution · `> 15` danger; **wind opposing current bumps the wind band up one level**. Combined verdict = worst of the three.
- Backfill scope: 2010 → present (~16 years, includes Irene Aug 2011 and Sandy Oct 2012). Expected 4–7M rows.
- NOAA rate limit 10 req/s; backfill chunked with per-chunk retry.
- Two ClickHouse users: `ingest` (INSERT+SELECT) and `agent_ro` (SELECT only).
- **Timestamps:** every `ts` in code is **epoch seconds (UTC instant)**. All NOAA requests use `time_zone=gmt`. ClickHouse `DateTime('America/New_York')` columns store the epoch value; the timezone is display metadata only. The UI formats with `timeZone: "America/New_York"`.
- Environment variables (exact names): `CLICKHOUSE_URL`, `CLICKHOUSE_ADMIN_USER`, `CLICKHOUSE_ADMIN_PASSWORD`, `CLICKHOUSE_INGEST_USER`, `CLICKHOUSE_INGEST_PASSWORD`, `CLICKHOUSE_AGENT_USER`, `CLICKHOUSE_AGENT_PASSWORD`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_REF`.

## Design Decisions (locked in for all tasks)

1. **Rich message parts render from AI SDK tool parts, not custom `data-*` chunks.** With AI SDK v5 + `chat.agent()`, every tool call streams into the `UIMessage` as a `tool-<name>` part with `input`/`output`. The spec's `data-verdict`/`data-windows`/`data-trip`/`data-watch`/`data-dashboard` map to React renderers keyed on tool part types: `tool-get_conditions_now` → VerdictCard, `tool-find_paddle_windows` → WindowsTimeline, `tool-log_trip`/`tool-schedule_watch` → ReceiptCard, `tool-render_dashboard` → DashboardRenderer (renders the tool **input**). This needs zero stream-writer plumbing and is resumable by default.
2. **Watch follow-up injection** uses the chat wire payload: `tasks.trigger("kayak-guide", { chatId, message: <UIMessage>, trigger: "submit-message" })` delivers a message into the session (verified against `ChatTaskWirePayload` in `@trigger.dev/sdk` 4.5.4 — `message` + `chatId` + `trigger: "submit-message"`). The injected message is a user-role message prefixed `[Watch update]`; the agent responds in-thread.
3. **Watch checkpoints** are one `watch-trip` run per watch using durable `wait.until()` at T-24h and T-3h (checkpoints already past are skipped; if trip < 3h away, one immediate check). Cancellation is cooperative: the run re-reads `watches.status` after each wait and exits if `cancelled`.
4. **Verdict-at-future-time** (`assessAtTime`) = latest discharge (constant) + interpolated predicted current + NWS forecast wind. `get_conditions_now` uses Robbins Reef **observed** wind instead.
5. **NOAA historical chunking:** USGS by (station, year); NOAA `hourly_height` (verified water levels) by year; NOAA `wind` by month (31-day API cap).

## File Structure

```
kayak-guide/
├── LICENSE                          # MIT
├── package.json / tsconfig.json / next.config.ts / vitest.config.ts
├── trigger.config.ts
├── .env.example
├── scripts/
│   ├── migrate.ts                   # DDL: tables + users/grants doc
│   └── seed-waypoints.ts            # waypoints fixture → ClickHouse
├── src/
│   ├── lib/
│   │   ├── types.ts                 # Reading, Prediction, Band, Verdict, ...
│   │   ├── ch.ts                    # ClickHouse clients + insert helpers
│   │   ├── safety.ts                # assessSafety, windOpposesCurrent (pure)
│   │   ├── windows.ts               # interpolateCurrent, findPaddleWindows (pure)
│   │   ├── roundtrip.ts             # planRoundTrip (pure)
│   │   ├── sqlguard.ts              # assertSelectOnly (pure)
│   │   ├── queries.ts               # named ClickHouse queries (agent_ro)
│   │   ├── assess.ts                # assessNow / assessAtTime (queries + safety)
│   │   ├── waypoints.ts             # curated fixture + prompt summary
│   │   └── sources/
│   │       ├── usgs.ts              # URL builder + parser + fetch
│   │       ├── noaa.ts              # CO-OPS URL builder + parsers + fetch
│   │       └── nws.ts               # hourly wind forecast client + compass math
│   ├── trigger/
│   │   ├── ingest.ts                # ingest-live (cron 15m), refresh-predictions (cron 6h)
│   │   ├── backfill.ts              # backfill-historical (chunked)
│   │   ├── kayak-tools.ts           # AI SDK tool() definitions
│   │   ├── kayak-guide.ts           # chat.agent() task + system prompt
│   │   └── watch-trip.ts            # delayed watch runs + Resend + injection
│   ├── app/
│   │   ├── layout.tsx / globals.css
│   │   ├── page.tsx                 # single-page chat app
│   │   └── actions.ts               # startChatSession + mintChatToken server actions
│   └── components/
│       ├── Chat.tsx                 # useChat + transport + part router
│       ├── VerdictCard.tsx / WindowsTimeline.tsx / DashboardRenderer.tsx
│       ├── ReceiptCard.tsx / ToolTrace.tsx / Sidebar.tsx / Identity.tsx
└── tests/
    ├── safety.test.ts / usgs.test.ts / noaa.test.ts / nws.test.ts
    ├── windows.test.ts / roundtrip.test.ts / sqlguard.test.ts
    └── queries.integration.test.ts  # gated on CLICKHOUSE_URL
```

---

### Task 1: Repo Scaffold & Tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `trigger.config.ts`, `LICENSE`, `.env.example`, `src/app/layout.tsx`, `src/app/globals.css`, `.gitignore`

**Interfaces:**
- Produces: a building Next.js + Trigger.dev + vitest project every later task drops files into; `npm test` and `npm run build` both pass.

- [ ] **Step 1: Scaffold Next.js in the repo root**

Run from `/Users/hk/Desktop/0719/kayak-guide`:

```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --no-eslint --use-npm --yes
```

(The repo already contains `docs/` and `.git/`; create-next-app tolerates non-empty dirs with `--yes`. If it refuses, scaffold into `/tmp/kg-scaffold` and `cp -R /tmp/kg-scaffold/. .` excluding `.git`.)

- [ ] **Step 2: Install dependencies**

```bash
npm install @trigger.dev/sdk@^4.5.4 ai @ai-sdk/react @ai-sdk/anthropic @clickhouse/client resend zod recharts
npm install -D trigger.dev@^4.5.4 @trigger.dev/build@^4.5.4 vitest tsx
```

- [ ] **Step 3: Add config files**

`trigger.config.ts`:

```ts
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_REPLACE_ME",
  dirs: ["./src/trigger"],
  maxDuration: 3600,
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/**/*.test.ts"] },
});
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest",
"dev:trigger": "trigger dev",
"migrate": "tsx scripts/migrate.ts",
"seed:waypoints": "tsx scripts/seed-waypoints.ts"
```

`.env.example` (every var from Global Constraints, empty values):

```bash
CLICKHOUSE_URL=https://xxx.clickhouse.cloud:8443
CLICKHOUSE_ADMIN_USER=default
CLICKHOUSE_ADMIN_PASSWORD=
CLICKHOUSE_INGEST_USER=ingest
CLICKHOUSE_INGEST_PASSWORD=
CLICKHOUSE_AGENT_USER=agent_ro
CLICKHOUSE_AGENT_PASSWORD=
ANTHROPIC_API_KEY=
RESEND_API_KEY=
ALERT_FROM_EMAIL=alerts@example.com
TRIGGER_SECRET_KEY=
TRIGGER_PROJECT_REF=
```

`LICENSE`: standard MIT text, `Copyright (c) 2026 KayakGuide contributors`.

- [ ] **Step 4: Verify build and empty test run**

```bash
npm run build && npm test
```

Expected: build succeeds; vitest reports "no test files found" (exit 0 with `--passWithNoTests`; add that flag to the `test` script if it exits non-zero).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js + Trigger.dev + vitest project

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: ClickHouse Clients, Schema Migration & Users

**Files:**
- Create: `src/lib/types.ts`, `src/lib/ch.ts`, `scripts/migrate.ts`

**Interfaces:**
- Produces:
  - `type Reading = { station_id: string; source: "usgs" | "noaa"; parameter: string; ts: number; value: number }`
  - `type Prediction = { station_id: string; kind: "tide" | "current"; ts: number; value: number; extreme: string }`
  - `chIngest(): ClickHouseClient` and `chAgent(): ClickHouseClient` (memoized)
  - `insertReadings(rows: Reading[]): Promise<void>`, `insertPredictions(rows: Prediction[]): Promise<void>`
  - Tables `readings`, `predictions`, `trips`, `watches`, `waypoints` existing in ClickHouse Cloud.

- [ ] **Step 1: Write `src/lib/types.ts`**

```ts
export type Reading = {
  station_id: string;
  source: "usgs" | "noaa";
  parameter: string; // discharge | gage_height | water_temp | tide_observed | current_speed | wind_speed | wind_gust | wind_dir
  ts: number; // epoch seconds UTC
  value: number;
};

export type Prediction = {
  station_id: string;
  kind: "tide" | "current";
  ts: number;
  value: number;
  extreme: string; // 'H','L','slack','max_flood','max_ebb',''
};

export type Band = "safe" | "caution" | "danger";

export type VerdictFactor = {
  name: "discharge" | "current" | "wind";
  value: number | null;
  band: Band;
  detail: string;
};

export type Verdict = {
  level: Band;
  factors: VerdictFactor[];
  windOpposesCurrent: boolean;
};

export type Waypoint = {
  waypoint_id: string;
  name: string;
  lat: number;
  lon: number;
  kind: "launch" | "landmark" | "hazard";
  notes: string;
};
```

- [ ] **Step 2: Write `src/lib/ch.ts`**

```ts
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { Reading, Prediction } from "./types";

let ingest: ClickHouseClient | undefined;
let agent: ClickHouseClient | undefined;

export function chIngest(): ClickHouseClient {
  ingest ??= createClient({
    url: process.env.CLICKHOUSE_URL!,
    username: process.env.CLICKHOUSE_INGEST_USER!,
    password: process.env.CLICKHOUSE_INGEST_PASSWORD!,
  });
  return ingest;
}

export function chAgent(): ClickHouseClient {
  agent ??= createClient({
    url: process.env.CLICKHOUSE_URL!,
    username: process.env.CLICKHOUSE_AGENT_USER!,
    password: process.env.CLICKHOUSE_AGENT_PASSWORD!,
  });
  return agent;
}

export async function insertReadings(rows: Reading[]): Promise<void> {
  if (rows.length === 0) return;
  await chIngest().insert({ table: "readings", values: rows, format: "JSONEachRow" });
}

export async function insertPredictions(rows: Prediction[]): Promise<void> {
  if (rows.length === 0) return;
  await chIngest().insert({ table: "predictions", values: rows, format: "JSONEachRow" });
}
```

(JSONEachRow accepts epoch-second integers for `DateTime` columns — no format juggling.)

- [ ] **Step 3: Write `scripts/migrate.ts`**

Uses the admin user; DDL is the spec's schema verbatim; also creates the two app users when `CLICKHOUSE_INGEST_PASSWORD`/`CLICKHOUSE_AGENT_PASSWORD` are set.

```ts
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_ADMIN_USER ?? "default",
  password: process.env.CLICKHOUSE_ADMIN_PASSWORD!,
});

const ddl = [
  `CREATE TABLE IF NOT EXISTS readings (
    station_id LowCardinality(String),
    source     LowCardinality(String),
    parameter  LowCardinality(String),
    ts         DateTime('America/New_York'),
    value      Float64
  ) ENGINE = ReplacingMergeTree ORDER BY (station_id, parameter, ts)`,
  `CREATE TABLE IF NOT EXISTS predictions (
    station_id LowCardinality(String),
    kind       LowCardinality(String),
    ts         DateTime('America/New_York'),
    value      Float64,
    extreme    LowCardinality(String)
  ) ENGINE = ReplacingMergeTree ORDER BY (station_id, kind, ts)`,
  `CREATE TABLE IF NOT EXISTS trips (
    trip_id    UUID,
    user_id    String,
    started_at DateTime('America/New_York'),
    route      String,
    rating     LowCardinality(String),
    notes      String,
    created_at DateTime DEFAULT now()
  ) ENGINE = MergeTree ORDER BY (user_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS watches (
    watch_id   UUID,
    user_id    String,
    chat_id    String,
    trip_time  DateTime('America/New_York'),
    email      String,
    status     LowCardinality(String),
    created_at DateTime DEFAULT now()
  ) ENGINE = ReplacingMergeTree(created_at) ORDER BY watch_id`,
  `CREATE TABLE IF NOT EXISTS waypoints (
    waypoint_id LowCardinality(String),
    name        String,
    lat         Float64,
    lon         Float64,
    kind        LowCardinality(String),
    notes       String
  ) ENGINE = MergeTree ORDER BY waypoint_id`,
];

const users = [
  `CREATE USER IF NOT EXISTS ingest IDENTIFIED BY '${process.env.CLICKHOUSE_INGEST_PASSWORD}'`,
  `GRANT SELECT, INSERT ON default.* TO ingest`,
  `CREATE USER IF NOT EXISTS agent_ro IDENTIFIED BY '${process.env.CLICKHOUSE_AGENT_PASSWORD}'`,
  `GRANT SELECT ON default.* TO agent_ro`,
];

async function main() {
  for (const q of ddl) await ch.command({ query: q });
  if (process.env.CLICKHOUSE_INGEST_PASSWORD && process.env.CLICKHOUSE_AGENT_PASSWORD) {
    for (const q of users) await ch.command({ query: q });
  }
  console.log("migration complete");
  await ch.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Provision ClickHouse Cloud and run the migration**

Manual: create a ClickHouse Cloud trial service, fill `.env` (copy `.env.example` → `.env`, also `.env.local` for Next.js). Then:

```bash
npx tsx --env-file=.env scripts/migrate.ts
```

Expected output: `migration complete`. Verify:

```bash
echo "SHOW TABLES" | curl -s "$CLICKHOUSE_URL" -u "$CLICKHOUSE_ADMIN_USER:$CLICKHOUSE_ADMIN_PASSWORD" --data-binary @-
```

Expected: lists `predictions readings trips watches waypoints`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/ch.ts scripts/migrate.ts
git commit -m "feat: ClickHouse schema migration, users, and typed clients

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Wind-Aware Safety Verdict (TDD)

**Files:**
- Create: `src/lib/safety.ts`
- Test: `tests/safety.test.ts`

**Interfaces:**
- Consumes: `Band`, `Verdict`, `VerdictFactor` from `src/lib/types.ts`.
- Produces:
  - `type CurrentPhase = "flood" | "ebb" | "slack"`
  - `assessSafety(input: { dischargeCfs?: number | null; currentKnots?: number | null; currentPhase?: CurrentPhase; windKnots?: number | null; windFromDeg?: number | null }): Verdict`
  - `windOpposesCurrent(windFromDeg: number, phase: CurrentPhase): boolean`
  - `band3(value: number, caution: number, danger: number): Band`
  - `bump(b: Band): Band`
  - `worst(bands: Band[]): Band`

- [ ] **Step 1: Write the failing tests** — `tests/safety.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assessSafety, windOpposesCurrent, band3, bump } from "@/lib/safety";

describe("band3", () => {
  it("classifies below caution as safe, between as caution, above danger as danger", () => {
    expect(band3(14999, 15000, 25000)).toBe("safe");
    expect(band3(15000, 15000, 25000)).toBe("caution");
    expect(band3(25001, 15000, 25000)).toBe("danger");
  });
});

describe("bump", () => {
  it("escalates one level and saturates at danger", () => {
    expect(bump("safe")).toBe("caution");
    expect(bump("caution")).toBe("danger");
    expect(bump("danger")).toBe("danger");
  });
});

describe("windOpposesCurrent", () => {
  it("south wind opposes the ebb (classic Hudson chop-maker)", () => {
    // ebb flows toward ~183°; wind FROM 180° blows northward against it
    expect(windOpposesCurrent(180, "ebb")).toBe(true);
  });
  it("north wind opposes the flood", () => {
    expect(windOpposesCurrent(10, "flood")).toBe(true);
  });
  it("west wind does not oppose the ebb; slack never opposes", () => {
    expect(windOpposesCurrent(270, "ebb")).toBe(false);
    expect(windOpposesCurrent(180, "slack")).toBe(false);
  });
});

describe("assessSafety", () => {
  it("all-calm input is safe", () => {
    const v = assessSafety({ dischargeCfs: 8000, currentKnots: 0.8, currentPhase: "flood", windKnots: 5, windFromDeg: 270 });
    expect(v.level).toBe("safe");
    expect(v.factors).toHaveLength(3);
  });
  it("verdict is the worst factor", () => {
    const v = assessSafety({ dischargeCfs: 30000, currentKnots: 0.5, currentPhase: "slack", windKnots: 3, windFromDeg: 0 });
    expect(v.level).toBe("danger");
  });
  it("opposing wind bumps the wind band one level", () => {
    // 12 kt wind alone = caution; opposing the ebb → danger
    const v = assessSafety({ dischargeCfs: 8000, currentKnots: 2.0, currentPhase: "ebb", windKnots: 12, windFromDeg: 180 });
    expect(v.windOpposesCurrent).toBe(true);
    expect(v.factors.find((f) => f.name === "wind")!.band).toBe("danger");
    expect(v.level).toBe("danger");
  });
  it("missing inputs yield safe bands with null values (data gap, not danger)", () => {
    const v = assessSafety({});
    expect(v.level).toBe("safe");
    expect(v.factors.every((f) => f.value === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/safety.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/safety'`.

- [ ] **Step 3: Implement `src/lib/safety.ts`**

```ts
import type { Band, Verdict, VerdictFactor } from "./types";

export type CurrentPhase = "flood" | "ebb" | "slack";

const RANK: Record<Band, number> = { safe: 0, caution: 1, danger: 2 };

export function band3(value: number, caution: number, danger: number): Band {
  if (value > danger) return "danger";
  if (value >= caution) return "caution";
  return "safe";
}

export function bump(b: Band): Band {
  return b === "safe" ? "caution" : "danger";
}

export function worst(bands: Band[]): Band {
  return bands.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "safe");
}

// Mean flow directions at NYH1927_13: flood toward ~11°, ebb toward ~183°.
const FLOW_TOWARD: Record<Exclude<CurrentPhase, "slack">, number> = { flood: 11, ebb: 183 };

function angDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Wind direction is meteorological (FROM). Wind opposes the current when the
// air moves against the water: wind FROM ≈ the direction the current flows TOWARD.
export function windOpposesCurrent(windFromDeg: number, phase: CurrentPhase): boolean {
  if (phase === "slack") return false;
  return angDist(windFromDeg, FLOW_TOWARD[phase]) < 60;
}

export function assessSafety(input: {
  dischargeCfs?: number | null;
  currentKnots?: number | null;
  currentPhase?: CurrentPhase;
  windKnots?: number | null;
  windFromDeg?: number | null;
}): Verdict {
  const factors: VerdictFactor[] = [];

  const d = input.dischargeCfs ?? null;
  factors.push({
    name: "discharge",
    value: d,
    band: d === null ? "safe" : band3(d, 15000, 25000),
    detail: d === null ? "no discharge data" : `${Math.round(d).toLocaleString()} cfs`,
  });

  const c = input.currentKnots === null || input.currentKnots === undefined ? null : Math.abs(input.currentKnots);
  factors.push({
    name: "current",
    value: c,
    band: c === null ? "safe" : band3(c, 1.5, 2.5),
    detail: c === null ? "no current data" : `${c.toFixed(1)} kt ${input.currentPhase ?? ""}`.trim(),
  });

  const w = input.windKnots ?? null;
  const opposes =
    w !== null && input.windFromDeg !== null && input.windFromDeg !== undefined && input.currentPhase !== undefined
      ? windOpposesCurrent(input.windFromDeg, input.currentPhase)
      : false;
  let windBand: Band = w === null ? "safe" : band3(w, 10, 15);
  if (opposes && w !== null) windBand = bump(windBand);
  factors.push({
    name: "wind",
    value: w,
    band: windBand,
    detail: w === null ? "no wind data" : `${w.toFixed(0)} kt${opposes ? " opposing current" : ""}`,
  });

  return { level: worst(factors.map((f) => f.band)), factors, windOpposesCurrent: opposes };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/safety.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/safety.ts tests/safety.test.ts
git commit -m "feat: wind-aware safety verdict with opposing-current rule

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: USGS Client & Parser (TDD)

**Files:**
- Create: `src/lib/sources/usgs.ts`
- Test: `tests/usgs.test.ts`

**Interfaces:**
- Consumes: `Reading` from `src/lib/types.ts`.
- Produces:
  - `usgsUrl(station: string, opts: { period?: string; startDT?: string; endDT?: string }): string`
  - `parseUsgs(json: unknown): Reading[]`
  - `fetchUsgs(station: string, opts: { period?: string; startDT?: string; endDT?: string }): Promise<Reading[]>`

- [ ] **Step 1: Write the failing tests** — `tests/usgs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { usgsUrl, parseUsgs } from "@/lib/sources/usgs";

const fixture = {
  value: {
    timeSeries: [
      {
        sourceInfo: { siteCode: [{ value: "01335754" }] },
        variable: { variableCode: [{ value: "00060" }] },
        values: [{ value: [
          { dateTime: "2026-07-19T10:00:00.000-04:00", value: "9210" },
          { dateTime: "2026-07-19T10:15:00.000-04:00", value: "-999999" }, // sentinel: drop
        ] }],
      },
      {
        sourceInfo: { siteCode: [{ value: "01335754" }] },
        variable: { variableCode: [{ value: "00065" }] },
        values: [{ value: [{ dateTime: "2026-07-19T10:00:00.000-04:00", value: "3.42" }] }],
      },
    ],
  },
};

describe("usgsUrl", () => {
  it("builds an instantaneous-values URL with params for all three parameters", () => {
    const url = usgsUrl("01335754", { period: "PT2H" });
    expect(url).toContain("waterservices.usgs.gov/nwis/iv/");
    expect(url).toContain("sites=01335754");
    expect(url).toContain("parameterCd=00060,00065,00010");
    expect(url).toContain("period=PT2H");
  });
  it("supports explicit date ranges for backfill", () => {
    const url = usgsUrl("01377260", { startDT: "2012-01-01", endDT: "2012-12-31" });
    expect(url).toContain("startDT=2012-01-01");
    expect(url).toContain("endDT=2012-12-31");
  });
});

describe("parseUsgs", () => {
  it("maps parameter codes to names and converts timestamps to epoch seconds", () => {
    const rows = parseUsgs(fixture);
    expect(rows).toHaveLength(2); // sentinel dropped
    const discharge = rows.find((r) => r.parameter === "discharge")!;
    expect(discharge.station_id).toBe("01335754");
    expect(discharge.source).toBe("usgs");
    expect(discharge.value).toBe(9210);
    expect(discharge.ts).toBe(Math.floor(Date.parse("2026-07-19T10:00:00.000-04:00") / 1000));
    expect(rows.find((r) => r.parameter === "gage_height")!.value).toBe(3.42);
  });
  it("returns [] for empty or malformed payloads", () => {
    expect(parseUsgs({})).toEqual([]);
    expect(parseUsgs({ value: { timeSeries: [] } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/usgs.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/sources/usgs.ts`**

```ts
import type { Reading } from "../types";

const PARAM_MAP: Record<string, string> = {
  "00060": "discharge",
  "00065": "gage_height",
  "00010": "water_temp",
};

export function usgsUrl(station: string, opts: { period?: string; startDT?: string; endDT?: string }): string {
  const p = new URLSearchParams({ format: "json", sites: station, parameterCd: "00060,00065,00010" });
  if (opts.period) p.set("period", opts.period);
  if (opts.startDT) p.set("startDT", opts.startDT);
  if (opts.endDT) p.set("endDT", opts.endDT);
  return `https://waterservices.usgs.gov/nwis/iv/?${p}`;
}

export function parseUsgs(json: unknown): Reading[] {
  const series = (json as any)?.value?.timeSeries;
  if (!Array.isArray(series)) return [];
  const rows: Reading[] = [];
  for (const s of series) {
    const parameter = PARAM_MAP[s?.variable?.variableCode?.[0]?.value];
    const station = s?.sourceInfo?.siteCode?.[0]?.value;
    if (!parameter || !station) continue;
    for (const v of s?.values?.[0]?.value ?? []) {
      const value = parseFloat(v.value);
      if (!Number.isFinite(value) || value <= -999998) continue;
      rows.push({ station_id: station, source: "usgs", parameter, ts: Math.floor(Date.parse(v.dateTime) / 1000), value });
    }
  }
  return rows;
}

export async function fetchUsgs(station: string, opts: { period?: string; startDT?: string; endDT?: string }): Promise<Reading[]> {
  const res = await fetch(usgsUrl(station, opts), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`USGS ${station} HTTP ${res.status}`);
  return parseUsgs(await res.json());
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/usgs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sources/usgs.ts tests/usgs.test.ts
git commit -m "feat: USGS instantaneous-values client and parser

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: NOAA CO-OPS Client & Parsers (TDD)

**Files:**
- Create: `src/lib/sources/noaa.ts`
- Test: `tests/noaa.test.ts`

**Interfaces:**
- Consumes: `Reading`, `Prediction` from `src/lib/types.ts`.
- Produces:
  - `coopsUrl(product: string, station: string, extra: Record<string, string>): string` — always sets `time_zone=gmt&units=english&format=json&application=kayakguide`
  - `parseWaterLevel(json: unknown, station: string): Reading[]` — `tide_observed`
  - `parseWind(json: unknown, station: string): Reading[]` — `wind_speed`, `wind_gust`, `wind_dir` (3 rows per sample)
  - `parseTidePredictions(json: unknown, station: string): Prediction[]` — `extreme` `'H'|'L'`
  - `parseCurrentPredictions(json: unknown, station: string): Prediction[]` — `extreme` `'slack'|'max_flood'|'max_ebb'`, signed knots (ebb negative)
  - `fetchCoops<T>(url: string, parse: (j: unknown) => T): Promise<T>` — one retry on failure

- [ ] **Step 1: Write the failing tests** — `tests/noaa.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { coopsUrl, parseWaterLevel, parseWind, parseTidePredictions, parseCurrentPredictions } from "@/lib/sources/noaa";

describe("coopsUrl", () => {
  it("always requests gmt/english/json", () => {
    const url = coopsUrl("water_level", "8518750", { date: "latest" });
    expect(url).toContain("api.tidesandcurrents.noaa.gov");
    expect(url).toContain("time_zone=gmt");
    expect(url).toContain("units=english");
    expect(url).toContain("station=8518750");
    expect(url).toContain("product=water_level");
  });
});

describe("parseWaterLevel", () => {
  it("maps t/v to tide_observed readings with epoch-second ts", () => {
    const rows = parseWaterLevel({ data: [{ t: "2026-07-19 14:00", v: "2.31" }] }, "8518750");
    expect(rows).toEqual([{
      station_id: "8518750", source: "noaa", parameter: "tide_observed",
      ts: Math.floor(Date.parse("2026-07-19T14:00:00Z") / 1000), value: 2.31,
    }]);
  });
  it("drops blank values", () => {
    expect(parseWaterLevel({ data: [{ t: "2026-07-19 14:00", v: "" }] }, "8518750")).toEqual([]);
  });
});

describe("parseWind", () => {
  it("emits speed, gust, and direction rows per sample", () => {
    const rows = parseWind({ data: [{ t: "2026-07-19 14:00", s: "11.5", g: "16.2", d: "184" }] }, "8530973");
    expect(rows.map((r) => [r.parameter, r.value])).toEqual([
      ["wind_speed", 11.5], ["wind_gust", 16.2], ["wind_dir", 184],
    ]);
    expect(rows.every((r) => r.station_id === "8530973" && r.source === "noaa")).toBe(true);
  });
});

describe("parseTidePredictions", () => {
  it("maps hilo predictions with H/L extremes", () => {
    const rows = parseTidePredictions({ predictions: [{ t: "2026-07-20 03:12", v: "4.8", type: "H" }] }, "8518750");
    expect(rows[0]).toMatchObject({ station_id: "8518750", kind: "tide", value: 4.8, extreme: "H" });
  });
});

describe("parseCurrentPredictions", () => {
  it("maps cp events with signed velocity and normalized extremes", () => {
    const rows = parseCurrentPredictions({ current_predictions: { cp: [
      { Time: "2026-07-20 05:40", Velocity_Major: "-1.8", Type: "ebb" },
      { Time: "2026-07-20 08:55", Velocity_Major: "0.1", Type: "slack" },
      { Time: "2026-07-20 11:30", Velocity_Major: "1.6", Type: "flood" },
    ] } }, "NYH1927_13");
    expect(rows.map((r) => r.extreme)).toEqual(["max_ebb", "slack", "max_flood"]);
    expect(rows[0].value).toBe(-1.8);
    expect(rows.every((r) => r.kind === "current")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/noaa.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/sources/noaa.ts`**

```ts
import type { Reading, Prediction } from "../types";

// CO-OPS timestamps arrive as "YYYY-MM-DD HH:MM" in the requested zone (gmt).
function gmtToEpoch(t: string): number {
  return Math.floor(Date.parse(t.replace(" ", "T") + ":00Z") / 1000);
}

export function coopsUrl(product: string, station: string, extra: Record<string, string>): string {
  const p = new URLSearchParams({
    product, station,
    time_zone: "gmt", units: "english", format: "json", application: "kayakguide",
    ...extra,
  });
  return `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${p}`;
}

export function parseWaterLevel(json: unknown, station: string): Reading[] {
  const data = (json as any)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((d: any) => d.v !== "" && Number.isFinite(parseFloat(d.v)))
    .map((d: any) => ({
      station_id: station, source: "noaa" as const, parameter: "tide_observed",
      ts: gmtToEpoch(d.t), value: parseFloat(d.v),
    }));
}

export function parseWind(json: unknown, station: string): Reading[] {
  const data = (json as any)?.data;
  if (!Array.isArray(data)) return [];
  const rows: Reading[] = [];
  for (const d of data) {
    const ts = gmtToEpoch(d.t);
    for (const [field, parameter] of [["s", "wind_speed"], ["g", "wind_gust"], ["d", "wind_dir"]] as const) {
      const value = parseFloat(d[field]);
      if (Number.isFinite(value)) rows.push({ station_id: station, source: "noaa", parameter, ts, value });
    }
  }
  return rows;
}

export function parseTidePredictions(json: unknown, station: string): Prediction[] {
  const preds = (json as any)?.predictions;
  if (!Array.isArray(preds)) return [];
  return preds.map((p: any) => ({
    station_id: station, kind: "tide" as const,
    ts: gmtToEpoch(p.t), value: parseFloat(p.v), extreme: p.type ?? "",
  }));
}

const CURRENT_EXTREME: Record<string, string> = { ebb: "max_ebb", flood: "max_flood", slack: "slack" };

export function parseCurrentPredictions(json: unknown, station: string): Prediction[] {
  const cp = (json as any)?.current_predictions?.cp;
  if (!Array.isArray(cp)) return [];
  return cp.map((c: any) => ({
    station_id: station, kind: "current" as const,
    ts: gmtToEpoch(c.Time), value: parseFloat(c.Velocity_Major),
    extreme: CURRENT_EXTREME[String(c.Type).toLowerCase()] ?? "",
  }));
}

export async function fetchCoops<T>(url: string, parse: (j: unknown) => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`CO-OPS HTTP ${res.status} for ${url}`);
      return parse(await res.json());
    } catch (e) {
      if (attempt >= 1) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
```

Note: current predictions for `NYH1927_13` are requested with `station=NYH1927&bin=13` in the URL but stored under station_id `NYH1927_13` — the caller passes the full ID to the parser.

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/noaa.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sources/noaa.ts tests/noaa.test.ts
git commit -m "feat: NOAA CO-OPS client and parsers (water level, wind, tide/current predictions)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: NWS Hourly Wind Forecast Client (TDD)

**Files:**
- Create: `src/lib/sources/nws.ts`
- Test: `tests/nws.test.ts`

**Interfaces:**
- Produces:
  - `type WindForecastHour = { ts: number; windKnots: number; gustKnots: number | null; windFromDeg: number }`
  - `compassToDeg(dir: string): number` — 16-point compass
  - `mphToKnots(mph: number): number`
  - `parseHourlyForecast(json: unknown): WindForecastHour[]`
  - `fetchHourlyWindForecast(): Promise<WindForecastHour[]>` — two-step: points → forecastHourly, with `User-Agent: kayakguide (solanamobilech@gmail.com)` header (NWS requires it)
  - `windAt(hours: WindForecastHour[], ts: number): WindForecastHour | null` — nearest hour within 90 min

- [ ] **Step 1: Write the failing tests** — `tests/nws.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compassToDeg, mphToKnots, parseHourlyForecast, windAt } from "@/lib/sources/nws";

describe("compassToDeg", () => {
  it("maps 16-point compass to degrees", () => {
    expect(compassToDeg("N")).toBe(0);
    expect(compassToDeg("S")).toBe(180);
    expect(compassToDeg("SSW")).toBe(202.5);
    expect(compassToDeg("NW")).toBe(315);
  });
});

describe("mphToKnots", () => {
  it("converts", () => {
    expect(mphToKnots(11.5078)).toBeCloseTo(10, 3);
  });
});

const fixture = { properties: { periods: [
  { startTime: "2026-07-20T09:00:00-04:00", windSpeed: "12 mph", windGust: "18 mph", windDirection: "S" },
  { startTime: "2026-07-20T10:00:00-04:00", windSpeed: "10 mph", windGust: null, windDirection: "SW" },
] } };

describe("parseHourlyForecast", () => {
  it("parses periods into knots + degrees with epoch ts", () => {
    const hours = parseHourlyForecast(fixture);
    expect(hours).toHaveLength(2);
    expect(hours[0].ts).toBe(Math.floor(Date.parse("2026-07-20T09:00:00-04:00") / 1000));
    expect(hours[0].windKnots).toBeCloseTo(12 / 1.15078, 2);
    expect(hours[0].gustKnots).toBeCloseTo(18 / 1.15078, 2);
    expect(hours[0].windFromDeg).toBe(180);
    expect(hours[1].gustKnots).toBeNull();
  });
});

describe("windAt", () => {
  it("returns the nearest hour within 90 minutes, else null", () => {
    const hours = parseHourlyForecast(fixture);
    const t0 = hours[0].ts;
    expect(windAt(hours, t0 + 600)).toBe(hours[0]);
    expect(windAt(hours, t0 + 3300)).toBe(hours[1]);
    expect(windAt(hours, t0 + 100 * 3600)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/nws.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/sources/nws.ts`**

```ts
export type WindForecastHour = { ts: number; windKnots: number; gustKnots: number | null; windFromDeg: number };

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compassToDeg(dir: string): number {
  const i = COMPASS.indexOf(dir.toUpperCase());
  return i === -1 ? 0 : i * 22.5;
}

export function mphToKnots(mph: number): number {
  return mph / 1.15078;
}

function parseSpeed(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /([\d.]+)\s*mph/.exec(s);
  return m ? mphToKnots(parseFloat(m[1])) : null;
}

export function parseHourlyForecast(json: unknown): WindForecastHour[] {
  const periods = (json as any)?.properties?.periods;
  if (!Array.isArray(periods)) return [];
  const hours: WindForecastHour[] = [];
  for (const p of periods) {
    const windKnots = parseSpeed(p.windSpeed);
    if (windKnots === null) continue;
    hours.push({
      ts: Math.floor(Date.parse(p.startTime) / 1000),
      windKnots,
      gustKnots: parseSpeed(p.windGust),
      windFromDeg: compassToDeg(String(p.windDirection ?? "N")),
    });
  }
  return hours;
}

const NWS_POINT = "40.7076,-74.0253"; // Hoboken Cove
const NWS_HEADERS = { "User-Agent": "kayakguide (solanamobilech@gmail.com)", Accept: "application/geo+json" };

export async function fetchHourlyWindForecast(): Promise<WindForecastHour[]> {
  const pt = await fetch(`https://api.weather.gov/points/${NWS_POINT}`, { headers: NWS_HEADERS });
  if (!pt.ok) throw new Error(`NWS points HTTP ${pt.status}`);
  const hourlyUrl = (await pt.json())?.properties?.forecastHourly;
  if (!hourlyUrl) throw new Error("NWS points response missing forecastHourly");
  const fc = await fetch(hourlyUrl, { headers: NWS_HEADERS });
  if (!fc.ok) throw new Error(`NWS forecastHourly HTTP ${fc.status}`);
  return parseHourlyForecast(await fc.json());
}

export function windAt(hours: WindForecastHour[], ts: number): WindForecastHour | null {
  let best: WindForecastHour | null = null;
  let bestDist = Infinity;
  for (const h of hours) {
    const d = Math.abs(h.ts - ts);
    if (d < bestDist) { best = h; bestDist = d; }
  }
  return bestDist <= 90 * 60 ? best : null;
}
```

- [ ] **Step 4: Run to verify pass, then smoke-test the live API**

```bash
npm test -- tests/nws.test.ts
npx tsx -e "import('./src/lib/sources/nws.ts').then(async m => console.log((await m.fetchHourlyWindForecast()).slice(0,3)))"
```

Expected: tests PASS; smoke test prints 3 forecast hours with plausible knots/degrees.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sources/nws.ts tests/nws.test.ts
git commit -m "feat: NWS hourly wind forecast client

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Ingestion Tasks (`ingest-live`, `refresh-predictions`)

**Files:**
- Create: `src/trigger/ingest.ts`

**Interfaces:**
- Consumes: `fetchUsgs` (Task 4); `coopsUrl`, `fetchCoops`, all NOAA parsers (Task 5); `insertReadings`, `insertPredictions` (Task 2).
- Produces: Trigger tasks with ids `ingest-live` and `refresh-predictions` (referenced by name in the README/demo; nothing imports them).

- [ ] **Step 1: Implement `src/trigger/ingest.ts`**

```ts
import { schedules } from "@trigger.dev/sdk";
import { fetchUsgs } from "@/lib/sources/usgs";
import { coopsUrl, fetchCoops, parseWaterLevel, parseWind, parseTidePredictions, parseCurrentPredictions } from "@/lib/sources/noaa";
import { insertReadings, insertPredictions } from "@/lib/ch";

export const ingestLive = schedules.task({
  id: "ingest-live",
  cron: "*/15 * * * *",
  run: async () => {
    const results = await Promise.allSettled([
      fetchUsgs("01335754", { period: "PT2H" }),
      fetchUsgs("01377260", { period: "PT2H" }),
      fetchCoops(coopsUrl("water_level", "8518750", { date: "latest" }), (j) => parseWaterLevel(j, "8518750")),
      fetchCoops(coopsUrl("wind", "8530973", { date: "latest" }), (j) => parseWind(j, "8530973")),
    ]);
    const rows = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const failures = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
    await insertReadings(rows);
    return { inserted: rows.length, failures };
  },
});

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export const refreshPredictions = schedules.task({
  id: "refresh-predictions",
  cron: "0 */6 * * *",
  run: async () => {
    const begin = yyyymmdd(new Date());
    const [tides, currents] = await Promise.all([
      fetchCoops(
        coopsUrl("predictions", "8518750", { datum: "MLLW", interval: "hilo", begin_date: begin, range: String(7 * 24) }),
        (j) => parseTidePredictions(j, "8518750"),
      ),
      fetchCoops(
        coopsUrl("currents_predictions", "NYH1927", { bin: "13", interval: "MAX_SLACK", begin_date: begin, range: String(7 * 24) }),
        (j) => parseCurrentPredictions(j, "NYH1927_13"),
      ),
    ]);
    await insertPredictions([...tides, ...currents]);
    return { tides: tides.length, currents: currents.length };
  },
});
```

- [ ] **Step 2: Run both tasks once via the dev server**

```bash
npx trigger dev
```

In the Trigger.dev dashboard (test tab), trigger `ingest-live` and `refresh-predictions` with empty payloads. Expected: both complete; outputs show `inserted > 0`, `tides > 0`, `currents > 0`, `failures: []`.

- [ ] **Step 3: Verify rows landed in ClickHouse**

```bash
echo "SELECT parameter, count(), max(ts) FROM readings GROUP BY parameter" | curl -s "$CLICKHOUSE_URL" -u "$CLICKHOUSE_ADMIN_USER:$CLICKHOUSE_ADMIN_PASSWORD" --data-binary @-
echo "SELECT kind, count() FROM predictions GROUP BY kind" | curl -s "$CLICKHOUSE_URL" -u "$CLICKHOUSE_ADMIN_USER:$CLICKHOUSE_ADMIN_PASSWORD" --data-binary @-
```

Expected: rows for `discharge`, `gage_height`, `tide_observed`, `wind_speed`, `wind_gust`, `wind_dir` (water_temp only if the station reports it); `tide` and `current` prediction counts > 0. Sanity-check `max(ts)` is within the last hour.

- [ ] **Step 4: Commit**

```bash
git add src/trigger/ingest.ts
git commit -m "feat: ingest-live and refresh-predictions cron tasks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Historical Backfill & Waypoints Seed

**Files:**
- Create: `src/trigger/backfill.ts`, `src/lib/waypoints.ts`, `scripts/seed-waypoints.ts`

**Interfaces:**
- Consumes: source clients (Tasks 4–5), insert helpers (Task 2).
- Produces:
  - Trigger task id `backfill-historical`, payload `{ fromYear?: number }` (default 2010).
  - `WAYPOINTS: Waypoint[]` and `waypointsPromptSummary(): string` from `src/lib/waypoints.ts` (used by the agent prompt in Task 12 and seed script).

- [ ] **Step 1: Implement `src/lib/waypoints.ts`**

```ts
import type { Waypoint } from "./types";

export const WAYPOINTS: Waypoint[] = [
  { waypoint_id: "hoboken-cove", name: "Hoboken Cove", lat: 40.7530, lon: -74.0261, kind: "launch", notes: "Beginner-friendly sandy launch; Hoboken Cove Community Boathouse home base; protected from wakes by Castle Point." },
  { waypoint_id: "pier-40", name: "Pier 40", lat: 40.7290, lon: -74.0113, kind: "launch", notes: "Manhattan-side launch (Village Community Boathouse); USGS tidal gage 01377260 lives here." },
  { waypoint_id: "pier-66", name: "Pier 66", lat: 40.7500, lon: -74.0090, kind: "landmark", notes: "Common turnaround for Hoboken round trips; kayak/sail hub in summer." },
  { waypoint_id: "weehawken-cove", name: "Weehawken Cove", lat: 40.7690, lon: -74.0225, kind: "landmark", notes: "Sheltered cove north of Hoboken; good bail-out point on a north run." },
  { waypoint_id: "intrepid", name: "Intrepid Museum", lat: 40.7645, lon: -73.9995, kind: "landmark", notes: "Landmark on the Manhattan side ~46th St; stay west of the channel here." },
  { waypoint_id: "ferry-lanes", name: "Midtown ferry lanes", lat: 40.7590, lon: -74.0150, kind: "hazard", notes: "NY Waterway ferries cross constantly between W 39th St and Hoboken/Weehawken; wakes stack steep against the ebb. Cross perpendicular, never linger." },
  { waypoint_id: "battery", name: "The Battery", lat: 40.7003, lon: -74.0150, kind: "landmark", notes: "Harbor opens up south of here — strong traffic and chop; NOAA tide station 8518750." },
];

export function waypointsPromptSummary(): string {
  return WAYPOINTS.map((w) => `- ${w.name} (${w.kind}): ${w.notes}`).join("\n");
}
```

- [ ] **Step 2: Implement `scripts/seed-waypoints.ts`**

```ts
import { chIngest } from "../src/lib/ch";
import { WAYPOINTS } from "../src/lib/waypoints";

async function main() {
  const ch = chIngest();
  await ch.command({ query: "TRUNCATE TABLE waypoints" });
  await ch.insert({ table: "waypoints", values: WAYPOINTS, format: "JSONEachRow" });
  console.log(`seeded ${WAYPOINTS.length} waypoints`);
  await ch.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:

```bash
npx tsx --env-file=.env scripts/seed-waypoints.ts
```

Expected: `seeded 7 waypoints`. (`TRUNCATE` needs the ingest user to hold TRUNCATE; if denied, grant it in migrate.ts users block: `GRANT TRUNCATE ON default.waypoints TO ingest`.)

- [ ] **Step 3: Implement `src/trigger/backfill.ts`**

Chunking: USGS by (station, year); NOAA `hourly_height` by year; NOAA `wind` by month. Sequential with a 150 ms gap (well under 10 req/s). Idempotent via ReplacingMergeTree.

```ts
import { task, logger } from "@trigger.dev/sdk";
import { fetchUsgs } from "@/lib/sources/usgs";
import { coopsUrl, fetchCoops, parseWaterLevel, parseWind } from "@/lib/sources/noaa";
import { insertReadings } from "@/lib/ch";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function monthChunks(year: number): Array<{ begin: string; end: string }> {
  const chunks = [];
  for (let m = 1; m <= 12; m++) {
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");
    chunks.push({ begin: `${year}${mm}01`, end: `${year}${mm}${String(last).padStart(2, "0")}` });
  }
  return chunks;
}

export const backfillHistorical = task({
  id: "backfill-historical",
  maxDuration: 3600 * 4,
  run: async (payload: { fromYear?: number }) => {
    const fromYear = payload.fromYear ?? 2010;
    const thisYear = new Date().getUTCFullYear();
    let total = 0;
    const failedChunks: string[] = [];

    for (let year = fromYear; year <= thisYear; year++) {
      // USGS: one request per station-year
      for (const station of ["01335754", "01377260"]) {
        try {
          const rows = await fetchUsgs(station, { startDT: `${year}-01-01`, endDT: `${year}-12-31` });
          await insertReadings(rows);
          total += rows.length;
          logger.info(`usgs ${station} ${year}: ${rows.length} rows`);
        } catch (e) {
          failedChunks.push(`usgs:${station}:${year}: ${e}`);
        }
        await sleep(150);
      }
      // NOAA verified hourly water levels: one request per year
      try {
        const rows = await fetchCoops(
          coopsUrl("hourly_height", "8518750", { datum: "MLLW", begin_date: `${year}0101`, end_date: `${year}1231` }),
          (j) => parseWaterLevel(j, "8518750"),
        );
        await insertReadings(rows);
        total += rows.length;
      } catch (e) {
        failedChunks.push(`hourly_height:${year}: ${e}`);
      }
      await sleep(150);
      // NOAA wind observations: 31-day cap → month chunks
      for (const { begin, end } of monthChunks(year)) {
        if (Number(begin) > Number(`${thisYear}${String(new Date().getUTCMonth() + 1).padStart(2, "0")}31`)) break;
        try {
          const rows = await fetchCoops(
            coopsUrl("wind", "8530973", { begin_date: begin, end_date: end }),
            (j) => parseWind(j, "8530973"),
          );
          await insertReadings(rows);
          total += rows.length;
        } catch (e) {
          failedChunks.push(`wind:${begin}: ${e}`);
        }
        await sleep(150);
      }
    }
    return { total, failedChunks };
  },
});
```

- [ ] **Step 4: Kick off the backfill and verify Sandy is in the data**

With `npx trigger dev` running, trigger `backfill-historical` with `{ "fromYear": 2010 }` from the dashboard (or deploy first — this run takes a while; it can run in the cloud while later tasks proceed). After it completes:

```bash
echo "SELECT count() FROM readings" | curl -s "$CLICKHOUSE_URL" -u "$CLICKHOUSE_ADMIN_USER:$CLICKHOUSE_ADMIN_PASSWORD" --data-binary @-
echo "SELECT max(value) FROM readings WHERE station_id='8518750' AND parameter='tide_observed' AND ts BETWEEN '2012-10-28' AND '2012-10-31'" | curl -s "$CLICKHOUSE_URL" -u "$CLICKHOUSE_ADMIN_USER:$CLICKHOUSE_ADMIN_PASSWORD" --data-binary @-
```

Expected: total in the millions; the Sandy query returns ~11 ft (MLLW) — the surge spike for the demo. Inspect `failedChunks` in the run output; re-run the task for any failed years (idempotent).

- [ ] **Step 5: Commit**

```bash
git add src/trigger/backfill.ts src/lib/waypoints.ts scripts/seed-waypoints.ts
git commit -m "feat: 2010+ historical backfill task and curated waypoints seed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Current Interpolation & Paddle-Window Finder (TDD)

**Files:**
- Create: `src/lib/windows.ts`
- Test: `tests/windows.test.ts`

**Interfaces:**
- Consumes: `assessSafety`, `CurrentPhase` (Task 3); `WindForecastHour`, `windAt` (Task 6); `Prediction` (Task 2).
- Produces:
  - `type CurrentEvent = { ts: number; value: number; extreme: string }`
  - `interpolateCurrent(events: CurrentEvent[], ts: number): number | null` — linear between surrounding events, null outside range
  - `currentPhase(v: number): CurrentPhase` — `|v| < 0.2` slack; positive flood; negative ebb
  - `type PaddleWindow = { start: number; end: number; level: "safe" | "caution"; maxWindKnots: number; maxCurrentKnots: number }`
  - `findPaddleWindows(opts: { from: number; to: number; skill: "beginner" | "experienced"; currents: CurrentEvent[]; wind: WindForecastHour[]; dischargeCfs: number | null }): PaddleWindow[]`

- [ ] **Step 1: Write the failing tests** — `tests/windows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { interpolateCurrent, currentPhase, findPaddleWindows, type CurrentEvent } from "@/lib/windows";
import type { WindForecastHour } from "@/lib/sources/nws";

const H = 3600;
const T0 = Math.floor(Date.parse("2026-07-26T08:00:00Z") / 1000);

// slack at T0, max flood +1.6kt at T0+3h, slack at T0+6h, max ebb -1.8kt at T0+9h
const currents: CurrentEvent[] = [
  { ts: T0, value: 0.0, extreme: "slack" },
  { ts: T0 + 3 * H, value: 1.6, extreme: "max_flood" },
  { ts: T0 + 6 * H, value: 0.0, extreme: "slack" },
  { ts: T0 + 9 * H, value: -1.8, extreme: "max_ebb" },
];

function calmWind(hours: number): WindForecastHour[] {
  return Array.from({ length: hours }, (_, i) => ({ ts: T0 + i * H, windKnots: 5, gustKnots: null, windFromDeg: 270 }));
}

describe("interpolateCurrent", () => {
  it("linearly interpolates between events", () => {
    expect(interpolateCurrent(currents, T0 + 1.5 * H)).toBeCloseTo(0.8, 5);
    expect(interpolateCurrent(currents, T0 + 3 * H)).toBeCloseTo(1.6, 5);
  });
  it("returns null outside the covered range", () => {
    expect(interpolateCurrent(currents, T0 - H)).toBeNull();
    expect(interpolateCurrent(currents, T0 + 20 * H)).toBeNull();
  });
});

describe("currentPhase", () => {
  it("classifies slack/flood/ebb", () => {
    expect(currentPhase(0.1)).toBe("slack");
    expect(currentPhase(1.0)).toBe("flood");
    expect(currentPhase(-1.0)).toBe("ebb");
  });
});

describe("findPaddleWindows", () => {
  it("finds safe windows around slack for a beginner in calm wind", () => {
    const wins = findPaddleWindows({
      from: T0, to: T0 + 9 * H, skill: "beginner",
      currents, wind: calmWind(10), dischargeCfs: 8000,
    });
    expect(wins.length).toBeGreaterThanOrEqual(1);
    // every returned hour must be fully safe for beginners
    expect(wins.every((w) => w.level === "safe")).toBe(true);
    // mid-flood hour (current interpolates >=1.5kt caution) must not be inside any window
    const midFlood = T0 + 3 * H;
    expect(wins.some((w) => w.start <= midFlood && midFlood < w.end)).toBe(false);
  });
  it("experienced paddlers also get caution windows", () => {
    const wins = findPaddleWindows({
      from: T0, to: T0 + 9 * H, skill: "experienced",
      currents, wind: calmWind(10), dischargeCfs: 8000,
    });
    const covered = wins.reduce((s, w) => s + (w.end - w.start), 0);
    expect(covered).toBeGreaterThan(6 * H); // caution hours included
  });
  it("strong opposing wind kills the ebb-side windows", () => {
    // 12kt south wind: caution alone, danger when opposing the ebb (after T0+6h)
    const southWind = calmWind(10).map((h) => ({ ...h, windKnots: 12, windFromDeg: 180 }));
    const wins = findPaddleWindows({
      from: T0 + 7 * H, to: T0 + 9 * H, skill: "experienced",
      currents, wind: southWind, dischargeCfs: 8000,
    });
    expect(wins).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/windows.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/windows.ts`**

```ts
import { assessSafety, type CurrentPhase } from "./safety";
import { windAt, type WindForecastHour } from "./sources/nws";

export type CurrentEvent = { ts: number; value: number; extreme: string };

export function interpolateCurrent(events: CurrentEvent[], ts: number): number | null {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  if (sorted.length === 0 || ts < sorted[0].ts || ts > sorted[sorted.length - 1].ts) return null;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (ts >= a.ts && ts <= b.ts) {
      const r = b.ts === a.ts ? 0 : (ts - a.ts) / (b.ts - a.ts);
      return a.value + (b.value - a.value) * r;
    }
  }
  return sorted[sorted.length - 1].value;
}

export function currentPhase(v: number): CurrentPhase {
  if (Math.abs(v) < 0.2) return "slack";
  return v > 0 ? "flood" : "ebb";
}

export type PaddleWindow = { start: number; end: number; level: "safe" | "caution"; maxWindKnots: number; maxCurrentKnots: number };

export function findPaddleWindows(opts: {
  from: number;
  to: number;
  skill: "beginner" | "experienced";
  currents: CurrentEvent[];
  wind: WindForecastHour[];
  dischargeCfs: number | null;
}): PaddleWindow[] {
  const H = 3600;
  const windows: PaddleWindow[] = [];
  let open: PaddleWindow | null = null;

  for (let ts = opts.from; ts < opts.to; ts += H) {
    const cur = interpolateCurrent(opts.currents, ts);
    const wind = windAt(opts.wind, ts);
    const phase = cur === null ? undefined : currentPhase(cur);
    const v = assessSafety({
      dischargeCfs: opts.dischargeCfs,
      currentKnots: cur,
      currentPhase: phase,
      windKnots: wind?.windKnots ?? null,
      windFromDeg: wind?.windFromDeg ?? null,
    });
    const hasData = cur !== null && wind !== null;
    const ok = hasData && (opts.skill === "beginner" ? v.level === "safe" : v.level !== "danger");

    if (ok) {
      const level = v.level as "safe" | "caution";
      if (open && (open.level === level || (open.level === "caution" && level === "safe"))) {
        open.end = ts + H;
        open.maxWindKnots = Math.max(open.maxWindKnots, wind!.windKnots);
        open.maxCurrentKnots = Math.max(open.maxCurrentKnots, Math.abs(cur!));
        if (level === "caution") open.level = "caution";
      } else {
        if (open) windows.push(open);
        open = { start: ts, end: ts + H, level, maxWindKnots: wind!.windKnots, maxCurrentKnots: Math.abs(cur!) };
      }
    } else if (open) {
      windows.push(open);
      open = null;
    }
  }
  if (open) windows.push(open);
  return windows;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/windows.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/windows.ts tests/windows.test.ts
git commit -m "feat: current interpolation and wind-aware paddle-window finder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Tide-Assisted Round-Trip Planner (TDD)

**Files:**
- Create: `src/lib/roundtrip.ts`
- Test: `tests/roundtrip.test.ts`

**Interfaces:**
- Consumes: `CurrentEvent`, `interpolateCurrent` (Task 9); `Waypoint` (Task 2 types).
- Produces:
  - `type RoundTripLeg = { departTs: number; arriveByTs: number; phase: "flood" | "ebb"; assistKnotsPeak: number }`
  - `type RoundTripPlan = { feasible: boolean; reason?: string; outbound?: RoundTripLeg; turnaroundTs?: number; ret?: RoundTripLeg }`
  - `planRoundTrip(opts: { launch: Waypoint; destination: Waypoint; dayStart: number; dayEnd: number; currents: CurrentEvent[] }): RoundTripPlan`

Planning rule (Hudson flows north on the flood): destination north of launch → outbound rides the **flood**, return rides the **ebb**; destination south → the reverse. A leg = the span from one slack event to the next, containing one max event of the wanted phase. The turnaround is the slack between the two legs. Legs must both fall inside `[dayStart, dayEnd]`.

- [ ] **Step 1: Write the failing tests** — `tests/roundtrip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planRoundTrip } from "@/lib/roundtrip";
import type { CurrentEvent } from "@/lib/windows";
import type { Waypoint } from "@/lib/types";

const H = 3600;
const T0 = Math.floor(Date.parse("2026-07-26T12:00:00Z") / 1000); // 08:00 EDT

// slack, max_flood, slack, max_ebb, slack
const currents: CurrentEvent[] = [
  { ts: T0, value: 0, extreme: "slack" },
  { ts: T0 + 3 * H, value: 1.4, extreme: "max_flood" },
  { ts: T0 + 6 * H, value: 0, extreme: "slack" },
  { ts: T0 + 9 * H, value: -1.7, extreme: "max_ebb" },
  { ts: T0 + 12 * H, value: 0, extreme: "slack" },
];

const hoboken: Waypoint = { waypoint_id: "hoboken-cove", name: "Hoboken Cove", lat: 40.753, lon: -74.0261, kind: "launch", notes: "" };
const weehawken: Waypoint = { waypoint_id: "weehawken-cove", name: "Weehawken Cove", lat: 40.769, lon: -74.0225, kind: "landmark", notes: "" };
const battery: Waypoint = { waypoint_id: "battery", name: "The Battery", lat: 40.7003, lon: -74.015, kind: "landmark", notes: "" };

describe("planRoundTrip", () => {
  it("northbound trip rides flood out, ebb home", () => {
    const plan = planRoundTrip({ launch: hoboken, destination: weehawken, dayStart: T0, dayEnd: T0 + 12 * H, currents });
    expect(plan.feasible).toBe(true);
    expect(plan.outbound!.phase).toBe("flood");
    expect(plan.outbound!.departTs).toBe(T0);          // slack before the flood
    expect(plan.turnaroundTs).toBe(T0 + 6 * H);        // slack between phases
    expect(plan.ret!.phase).toBe("ebb");
    expect(plan.ret!.assistKnotsPeak).toBeCloseTo(1.7, 5);
  });
  it("southbound trip wants ebb first — infeasible when the day only offers flood-then-ebb once ebb-first is required within the window", () => {
    const plan = planRoundTrip({ launch: hoboken, destination: battery, dayStart: T0, dayEnd: T0 + 6 * H, currents });
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/roundtrip.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/roundtrip.ts`**

```ts
import type { Waypoint } from "./types";
import type { CurrentEvent } from "./windows";

export type RoundTripLeg = { departTs: number; arriveByTs: number; phase: "flood" | "ebb"; assistKnotsPeak: number };
export type RoundTripPlan = { feasible: boolean; reason?: string; outbound?: RoundTripLeg; turnaroundTs?: number; ret?: RoundTripLeg };

type PhaseSpan = { phase: "flood" | "ebb"; start: number; end: number; peak: number };

// Build slack→slack spans, each labeled by the max event inside it.
function phaseSpans(events: CurrentEvent[]): PhaseSpan[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const spans: PhaseSpan[] = [];
  let lastSlack: number | null = null;
  let pendingMax: CurrentEvent | null = null;
  for (const e of sorted) {
    if (e.extreme === "slack") {
      if (lastSlack !== null && pendingMax) {
        spans.push({
          phase: pendingMax.extreme === "max_flood" ? "flood" : "ebb",
          start: lastSlack, end: e.ts, peak: Math.abs(pendingMax.value),
        });
      }
      lastSlack = e.ts;
      pendingMax = null;
    } else if (e.extreme === "max_flood" || e.extreme === "max_ebb") {
      pendingMax = e;
    }
  }
  return spans;
}

export function planRoundTrip(opts: {
  launch: Waypoint;
  destination: Waypoint;
  dayStart: number;
  dayEnd: number;
  currents: CurrentEvent[];
}): RoundTripPlan {
  const northbound = opts.destination.lat > opts.launch.lat;
  const outPhase: "flood" | "ebb" = northbound ? "flood" : "ebb";
  const retPhase: "flood" | "ebb" = northbound ? "ebb" : "flood";

  const spans = phaseSpans(opts.currents).filter((s) => s.start >= opts.dayStart && s.end <= opts.dayEnd);
  const out = spans.find((s) => s.phase === outPhase);
  const ret = out ? spans.find((s) => s.phase === retPhase && s.start >= out.end) : undefined;

  if (!out || !ret) {
    return {
      feasible: false,
      reason: `No ${outPhase}-then-${retPhase} sequence fits between ${new Date(opts.dayStart * 1000).toISOString()} and ${new Date(opts.dayEnd * 1000).toISOString()}. Try a longer window or the reverse direction.`,
    };
  }
  return {
    feasible: true,
    outbound: { departTs: out.start, arriveByTs: out.end, phase: out.phase, assistKnotsPeak: out.peak },
    turnaroundTs: out.end,
    ret: { departTs: ret.start, arriveByTs: ret.end, phase: ret.phase, assistKnotsPeak: ret.peak },
  };
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/roundtrip.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roundtrip.ts tests/roundtrip.test.ts
git commit -m "feat: tide-assisted round-trip planner

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: SQL Guard, Named Queries & Shared Assessment

**Files:**
- Create: `src/lib/sqlguard.ts`, `src/lib/queries.ts`, `src/lib/assess.ts`
- Test: `tests/sqlguard.test.ts`, `tests/queries.integration.test.ts`

**Interfaces:**
- Consumes: `chAgent` (Task 2); safety/windows/nws functions (Tasks 3, 6, 9).
- Produces (used verbatim by Tasks 12–13):
  - `assertSelectOnly(sql: string): void` — throws on anything but a single SELECT/WITH statement
  - `runGuardedSql(sql: string): Promise<{ rows: unknown[]; rowCount: number; elapsedMs: number }>`
  - `getLatestReadings(): Promise<Record<string, { value: number; ts: number }>>` — latest per parameter (keys: `discharge`, `gage_height`, `tide_observed`, `wind_speed`, `wind_gust`, `wind_dir`)
  - `getCurrentEvents(from: number, to: number): Promise<CurrentEvent[]>` — from `predictions` `kind='current'`
  - `getTideEvents(from: number, to: number): Promise<Array<{ ts: number; value: number; extreme: string }>>`
  - `getWaypoints(): Promise<Waypoint[]>`
  - `compareToHistory(opts: { metric: "discharge" | "gage_height" | "tide_observed" | "wind_speed"; mode: "percentile"; value: number } | { metric: ...same; mode: "series"; from: string; to: string }): Promise<unknown>`
  - `getRecentTrips(userId: string, limit?: number): Promise<unknown[]>`
  - `getWatchStatus(watchId: string): Promise<string | null>` / `setWatchStatus(...)` lives in Task 13 (write side)
  - `assessNow(): Promise<{ verdict: Verdict; readings: ...; tide: ...; current: { knots: number | null; phase: CurrentPhase }; dataAgeMinutes: number }>` (observed wind)
  - `assessAtTime(ts: number): Promise<{ verdict: Verdict; currentKnots: number | null; windKnots: number | null }>` (forecast wind)

- [ ] **Step 1: Write the failing guard tests** — `tests/sqlguard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertSelectOnly } from "@/lib/sqlguard";

describe("assertSelectOnly", () => {
  it("accepts SELECT and WITH queries, with or without trailing semicolon", () => {
    expect(() => assertSelectOnly("SELECT 1")).not.toThrow();
    expect(() => assertSelectOnly("  with x as (select 1) select * from x; ")).not.toThrow();
  });
  it("rejects writes and DDL", () => {
    for (const sql of [
      "INSERT INTO trips VALUES (1)",
      "DROP TABLE readings",
      "ALTER TABLE readings DELETE WHERE 1",
      "TRUNCATE TABLE watches",
      "CREATE TABLE x (a Int32) ENGINE=Memory",
    ]) expect(() => assertSelectOnly(sql)).toThrow(/read-only/i);
  });
  it("rejects multiple statements", () => {
    expect(() => assertSelectOnly("SELECT 1; SELECT 2")).toThrow(/single/i);
  });
  it("rejects comment smuggling", () => {
    expect(() => assertSelectOnly("/* hi */ DROP TABLE readings")).toThrow(/read-only/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/sqlguard.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/sqlguard.ts`**

```ts
export function assertSelectOnly(sql: string): void {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim()
    .replace(/;$/, "")
    .trim();
  if (stripped.includes(";")) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with)\b/i.test(stripped)) throw new Error("Rejected: this tool is read-only (SELECT/WITH only).");
}
```

- [ ] **Step 4: Run guard tests to verify pass**

```bash
npm test -- tests/sqlguard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Implement `src/lib/queries.ts`**

```ts
import { chAgent } from "./ch";
import { assertSelectOnly } from "./sqlguard";
import type { Waypoint } from "./types";
import type { CurrentEvent } from "./windows";

async function select<T>(query: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const rs = await chAgent().query({
    query,
    query_params: params,
    format: "JSONEachRow",
    clickhouse_settings: { readonly: "1" },
  });
  return rs.json<T>();
}

export async function runGuardedSql(sql: string): Promise<{ rows: unknown[]; rowCount: number; elapsedMs: number }> {
  assertSelectOnly(sql);
  const started = Date.now();
  const rs = await chAgent().query({
    query: sql,
    format: "JSONEachRow",
    clickhouse_settings: { readonly: "1", max_result_rows: "1000", max_execution_time: "10" },
  });
  const rows = await rs.json();
  return { rows, rowCount: rows.length, elapsedMs: Date.now() - started };
}

const STATION_FOR: Record<string, string> = {
  discharge: "01335754",
  gage_height: "01377260",
  tide_observed: "8518750",
  wind_speed: "8530973",
};

export async function getLatestReadings(): Promise<Record<string, { value: number; ts: number }>> {
  const rows = await select<{ parameter: string; value: number; ts: number }>(
    `SELECT parameter, argMax(value, ts) AS value, toUnixTimestamp(max(ts)) AS ts
     FROM readings
     WHERE ts > now() - INTERVAL 6 HOUR
     GROUP BY parameter`,
  );
  return Object.fromEntries(rows.map((r) => [r.parameter, { value: r.value, ts: r.ts }]));
}

export async function getCurrentEvents(from: number, to: number): Promise<CurrentEvent[]> {
  return select<CurrentEvent>(
    `SELECT toUnixTimestamp(ts) AS ts, value, extreme
     FROM predictions
     WHERE kind = 'current' AND station_id = 'NYH1927_13'
       AND ts BETWEEN toDateTime({from: UInt32}) AND toDateTime({to: UInt32})
     ORDER BY ts`,
    { from, to },
  );
}

export async function getTideEvents(from: number, to: number) {
  return select<{ ts: number; value: number; extreme: string }>(
    `SELECT toUnixTimestamp(ts) AS ts, value, extreme
     FROM predictions
     WHERE kind = 'tide' AND station_id = '8518750'
       AND ts BETWEEN toDateTime({from: UInt32}) AND toDateTime({to: UInt32})
     ORDER BY ts`,
    { from, to },
  );
}

export async function getWaypoints(): Promise<Waypoint[]> {
  return select<Waypoint>(`SELECT waypoint_id, name, lat, lon, kind, notes FROM waypoints ORDER BY waypoint_id`);
}

export async function compareToHistory(
  opts:
    | { metric: keyof typeof STATION_FOR; mode: "percentile"; value: number }
    | { metric: keyof typeof STATION_FOR; mode: "series"; from: string; to: string },
): Promise<unknown> {
  const station = STATION_FOR[opts.metric];
  if (opts.mode === "percentile") {
    const [pct] = await select<{ percentile: number; p10: number; p50: number; p90: number; n: number }>(
      `SELECT round(100 * countIf(value < {v: Float64}) / count(), 1) AS percentile,
              round(quantile(0.10)(value), 1) AS p10,
              round(quantile(0.50)(value), 1) AS p50,
              round(quantile(0.90)(value), 1) AS p90,
              count() AS n
       FROM readings
       WHERE station_id = {station: String} AND parameter = {metric: String}
         AND toMonth(ts) = toMonth(now())`,
      { v: opts.value, station, metric: opts.metric },
    );
    const analogs = await select<{ day: string; daily_avg: number }>(
      `SELECT toDate(ts) AS day, round(avg(value), 1) AS daily_avg
       FROM readings
       WHERE station_id = {station: String} AND parameter = {metric: String}
         AND toMonth(ts) = toMonth(now())
       GROUP BY day
       ORDER BY abs(daily_avg - {v: Float64}) ASC
       LIMIT 3`,
      { v: opts.value, station, metric: opts.metric },
    );
    return { ...pct, nearestAnalogDays: analogs, month: new Date().getUTCMonth() + 1 };
  }
  return select<{ hour: string; avg_value: number; max_value: number }>(
    `SELECT toStartOfHour(ts) AS hour, round(avg(value), 2) AS avg_value, round(max(value), 2) AS max_value
     FROM readings
     WHERE station_id = {station: String} AND parameter = {metric: String}
       AND ts BETWEEN parseDateTimeBestEffort({from: String}) AND parseDateTimeBestEffort({to: String})
     GROUP BY hour ORDER BY hour`,
    { station, metric: opts.metric, from: opts.from, to: opts.to },
  );
}

export async function getRecentTrips(userId: string, limit = 10): Promise<unknown[]> {
  return select(
    `SELECT toString(trip_id) AS trip_id, toUnixTimestamp(started_at) AS started_at, route, rating, notes
     FROM trips WHERE user_id = {userId: String}
     ORDER BY started_at DESC LIMIT {limit: UInt32}`,
    { userId, limit },
  );
}

export async function getWatchStatus(watchId: string): Promise<string | null> {
  const rows = await select<{ status: string }>(
    `SELECT status FROM watches FINAL WHERE watch_id = {watchId: String}`,
    { watchId },
  );
  return rows[0]?.status ?? null;
}

export const SCHEMA_DOC = `
Tables (ClickHouse, all timestamps DateTime in America/New_York):
- readings(station_id, source, parameter, ts, value): 16 years of sensor data.
  parameters: discharge (cfs, station 01335754), gage_height (ft, 01377260 = Pier 40),
  water_temp (C), tide_observed (ft MLLW, 8518750 = The Battery),
  wind_speed / wind_gust (knots) and wind_dir (degrees FROM) at 8530973 = Robbins Reef.
- predictions(station_id, kind, ts, value, extreme): NOAA predictions ~7 days ahead.
  kind='tide' (8518750, extreme H/L), kind='current' (NYH1927_13, knots signed
  flood-positive, extreme slack/max_flood/max_ebb).
- trips(trip_id, user_id, started_at, route, rating, notes): user trip log. rating: calm|choppy|rough.
- watches(watch_id, user_id, chat_id, trip_time, email, status, created_at): condition watches.
- waypoints(waypoint_id, name, lat, lon, kind, notes): local launches/landmarks/hazards.
Notable ranges: Hurricane Irene ~2011-08-28, Hurricane Sandy ~2012-10-29.
`;
```

- [ ] **Step 6: Implement `src/lib/assess.ts`**

```ts
import { assessSafety, type CurrentPhase } from "./safety";
import { interpolateCurrent, currentPhase } from "./windows";
import { fetchHourlyWindForecast, windAt } from "./sources/nws";
import { getLatestReadings, getCurrentEvents, getTideEvents } from "./queries";
import type { Verdict } from "./types";

const H = 3600;

export async function assessNow() {
  const now = Math.floor(Date.now() / 1000);
  const [readings, currents, tides] = await Promise.all([
    getLatestReadings(),
    getCurrentEvents(now - 12 * H, now + 12 * H),
    getTideEvents(now - 12 * H, now + 36 * H),
  ]);
  const currentKnots = interpolateCurrent(currents, now);
  const phase: CurrentPhase = currentKnots === null ? "slack" : currentPhase(currentKnots);
  const verdict = assessSafety({
    dischargeCfs: readings.discharge?.value ?? null,
    currentKnots,
    currentPhase: phase,
    windKnots: readings.wind_speed?.value ?? null, // Robbins Reef OBSERVED wind
    windFromDeg: readings.wind_dir?.value ?? null,
  });
  const newest = Math.max(0, ...Object.values(readings).map((r) => r.ts));
  return {
    verdict,
    readings,
    current: { knots: currentKnots, phase },
    nextTides: tides.filter((t) => t.ts > now).slice(0, 2),
    dataAgeMinutes: newest ? Math.round((now - newest) / 60) : null,
  };
}

export async function assessAtTime(ts: number): Promise<{ verdict: Verdict; currentKnots: number | null; windKnots: number | null }> {
  const [readings, currents, wind] = await Promise.all([
    getLatestReadings(),
    getCurrentEvents(ts - 12 * H, ts + 12 * H),
    fetchHourlyWindForecast(), // FORECAST wind for future times
  ]);
  const currentKnots = interpolateCurrent(currents, ts);
  const w = windAt(wind, ts);
  const verdict = assessSafety({
    dischargeCfs: readings.discharge?.value ?? null,
    currentKnots,
    currentPhase: currentKnots === null ? "slack" : currentPhase(currentKnots),
    windKnots: w?.windKnots ?? null,
    windFromDeg: w?.windFromDeg ?? null,
  });
  return { verdict, currentKnots, windKnots: w?.windKnots ?? null };
}
```

- [ ] **Step 7: Write the integration test** — `tests/queries.integration.test.ts` (gated; runs only with env set):

```ts
import { describe, it, expect } from "vitest";
import { runGuardedSql, getLatestReadings, getCurrentEvents, getWaypoints } from "@/lib/queries";

describe.skipIf(!process.env.CLICKHOUSE_URL)("queries (integration)", () => {
  it("runGuardedSql returns rows with timing", async () => {
    const r = await runGuardedSql("SELECT count() AS n FROM readings");
    expect(r.rowCount).toBe(1);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });
  it("latest readings include wind from Robbins Reef", async () => {
    const r = await getLatestReadings();
    expect(r.wind_speed).toBeDefined();
  });
  it("current events exist for the next 24h", async () => {
    const now = Math.floor(Date.now() / 1000);
    const evts = await getCurrentEvents(now, now + 24 * 3600);
    expect(evts.length).toBeGreaterThan(0);
    expect(["slack", "max_flood", "max_ebb"]).toContain(evts[0].extreme);
  });
  it("waypoints are seeded", async () => {
    expect((await getWaypoints()).length).toBeGreaterThanOrEqual(7);
  });
});
```

- [ ] **Step 8: Run the full suite (integration needs `.env` loaded)**

```bash
npx vitest run --env-file=.env 2>/dev/null || npx tsx --env-file=.env node_modules/.bin/vitest run
```

(If vitest lacks `--env-file`, add `import "dotenv/config"`-style loading via a `tests/setup.ts` that reads `.env` with `node:fs`, registered in `vitest.config.ts` `test.setupFiles`. Keep it dependency-free.)

Expected: all unit tests PASS; integration tests PASS against the live service (they require Tasks 7–8 data).

- [ ] **Step 9: Commit**

```bash
git add src/lib/sqlguard.ts src/lib/queries.ts src/lib/assess.ts tests/sqlguard.test.ts tests/queries.integration.test.ts
git commit -m "feat: guarded SQL, named ClickHouse queries, shared now/future assessment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: The Agent — `kayak-guide` chat.agent() with Data Tools

**Files:**
- Create: `src/trigger/kayak-tools.ts`, `src/trigger/kayak-guide.ts`

**Interfaces:**
- Consumes: everything from Tasks 3, 6, 9, 10, 11 (`assessNow`, `assessAtTime`, `findPaddleWindows`, `planRoundTrip`, `getCurrentEvents`, `getTideEvents`, `getWaypoints`, `compareToHistory`, `runGuardedSql`, `SCHEMA_DOC`, `waypointsPromptSummary`, `fetchHourlyWindForecast`, `getLatestReadings`).
- Produces:
  - `dataTools: ToolSet` (from `kayak-tools.ts`) — tools `get_conditions_now`, `find_paddle_windows`, `plan_round_trip`, `get_waypoints`, `compare_to_history`, `get_schema`, `query_river_data`, `render_dashboard`
  - `kayakGuide` — the `chat.agent()` task with id `"kayak-guide"`, clientData schema `{ userId: string; email: string }` (Tasks 13–14 import `typeof kayakGuide` and the id string).
  - Every tool returns `{ error: string }` instead of throwing, so the model can self-correct.

- [ ] **Step 1: Implement `src/trigger/kayak-tools.ts`**

```ts
import { tool } from "ai";
import { z } from "zod";
import { assessNow, assessAtTime } from "@/lib/assess";
import { findPaddleWindows } from "@/lib/windows";
import { planRoundTrip } from "@/lib/roundtrip";
import { fetchHourlyWindForecast } from "@/lib/sources/nws";
import { getCurrentEvents, getTideEvents, getWaypoints, getLatestReadings, compareToHistory, runGuardedSql, SCHEMA_DOC } from "@/lib/queries";

const H = 3600;
const iso = z.string().describe("ISO 8601 datetime, e.g. 2026-07-26T09:00:00-04:00");
const toEpoch = (s: string) => Math.floor(Date.parse(s) / 1000);

// Every execute returns { error } on failure so the model can retry with a corrected call.
const safe = <T extends (...a: any[]) => Promise<any>>(fn: T) =>
  async (...args: Parameters<T>) => {
    try { return await fn(...args); } catch (e) { return { error: String(e) }; }
  };

export const dataTools = {
  get_conditions_now: tool({
    description:
      "Latest observed river conditions: discharge, gage height, Robbins Reef wind, tide state, interpolated current — plus the traffic-light safety verdict. Call FIRST for any 'can I paddle' question.",
    inputSchema: z.object({}),
    execute: safe(async () => assessNow()),
  }),

  find_paddle_windows: tool({
    description:
      "Scan a time range for safe paddle windows using predicted currents and NWS forecast wind, applying skill-adjusted safety thresholds. Returns windows plus tide markers for the timeline.",
    inputSchema: z.object({ from: iso, to: iso, skill_level: z.enum(["beginner", "experienced"]) }),
    execute: safe(async ({ from, to, skill_level }) => {
      const [f, t] = [toEpoch(from), toEpoch(to)];
      const [currents, tides, wind, readings] = await Promise.all([
        getCurrentEvents(f - 6 * H, t + 6 * H),
        getTideEvents(f, t),
        fetchHourlyWindForecast(),
        getLatestReadings(),
      ]);
      const windows = findPaddleWindows({
        from: f, to: t, skill: skill_level,
        currents, wind, dischargeCfs: readings.discharge?.value ?? null,
      });
      return { from: f, to: t, skill_level, windows, tideMarkers: tides };
    }),
  }),

  plan_round_trip: tool({
    description:
      "Plan a tide-assisted round trip between two waypoints on a given date: outbound leg riding one current phase, return riding the reverse.",
    inputSchema: z.object({
      launch_waypoint: z.string().describe("waypoint_id, e.g. hoboken-cove"),
      destination_waypoint: z.string().describe("waypoint_id, e.g. pier-66"),
      date: z.string().describe("YYYY-MM-DD (local Eastern date)"),
    }),
    execute: safe(async ({ launch_waypoint, destination_waypoint, date }) => {
      const wps = await getWaypoints();
      const launch = wps.find((w) => w.waypoint_id === launch_waypoint);
      const destination = wps.find((w) => w.waypoint_id === destination_waypoint);
      if (!launch || !destination) return { error: `Unknown waypoint. Known: ${wps.map((w) => w.waypoint_id).join(", ")}` };
      const dayStart = toEpoch(`${date}T06:00:00-04:00`);
      const dayEnd = toEpoch(`${date}T21:00:00-04:00`);
      const currents = await getCurrentEvents(dayStart - 6 * H, dayEnd + 6 * H);
      return { launch, destination, ...planRoundTrip({ launch, destination, dayStart, dayEnd, currents }) };
    }),
  }),

  get_waypoints: tool({
    description: "Curated local knowledge: launches, landmarks, hazards on this stretch of the Hudson.",
    inputSchema: z.object({}),
    execute: safe(async () => ({ waypoints: await getWaypoints() })),
  }),

  compare_to_history: tool({
    description:
      "Ground a number in 16 years of history. mode='percentile': where does `value` sit vs the same calendar month historically (plus nearest analog days). mode='series': hourly avg/max series between from/to — use for storm replays (Sandy: 2012-10-28..2012-10-31, Irene: 2011-08-27..2011-08-30).",
    inputSchema: z.object({
      metric: z.enum(["discharge", "gage_height", "tide_observed", "wind_speed"]),
      mode: z.enum(["percentile", "series"]),
      value: z.number().optional().describe("required for mode=percentile"),
      from: iso.optional().describe("required for mode=series"),
      to: iso.optional().describe("required for mode=series"),
    }),
    execute: safe(async (args) => {
      if (args.mode === "percentile") {
        if (args.value === undefined) return { error: "mode=percentile requires value" };
        return compareToHistory({ metric: args.metric, mode: "percentile", value: args.value });
      }
      if (!args.from || !args.to) return { error: "mode=series requires from and to" };
      return { series: await compareToHistory({ metric: args.metric, mode: "series", from: args.from, to: args.to }) };
    }),
  }),

  get_schema: tool({
    description: "Table and column descriptions for the river database. Call before writing custom SQL.",
    inputSchema: z.object({}),
    execute: safe(async () => ({ schema: SCHEMA_DOC })),
  }),

  query_river_data: tool({
    description:
      "Run a read-only ClickHouse SELECT against the river database (max 1000 rows, 10s). Use get_schema first. Prefer named tools when one fits.",
    inputSchema: z.object({ sql: z.string() }),
    execute: safe(async ({ sql }) => runGuardedSql(sql)),
  }),

  render_dashboard: tool({
    description:
      "Render a dashboard in the chat from data you ALREADY queried (this tool has no database access). cards = KPI tiles; charts support area|bar|line|pie with optional x-axis annotations.",
    inputSchema: z.object({
      title: z.string(),
      cards: z.array(z.object({ title: z.string(), value: z.string(), subtitle: z.string().optional() })),
      charts: z.array(z.object({
        type: z.enum(["area", "bar", "line", "pie"]),
        title: z.string(),
        subtitle: z.string().optional(),
        data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
        xKey: z.string(),
        yKey: z.string(),
        annotations: z.array(z.object({ x: z.union([z.string(), z.number()]), label: z.string() })).optional(),
      })),
    }),
    execute: async () => ({ rendered: true }), // frontend renders the tool INPUT
  }),
};

export { assessAtTime }; // re-export for watch-trip
```

- [ ] **Step 2: Implement `src/trigger/kayak-guide.ts`**

```ts
import { chat } from "@trigger.dev/sdk/ai";
import { streamText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { dataTools } from "./kayak-tools";
import { actionTools } from "./action-tools"; // Task 13; until then, comment this line and the spread below
import { waypointsPromptSummary } from "@/lib/waypoints";

const SYSTEM = `You are KayakGuide, an experienced Hudson River paddling guide for the Hoboken/Manhattan stretch.
Voice: safety-first but not preachy; plain language — data should serve people, not intimidate them. You know the
Hoboken Cove Community Boathouse scene and the local water.

The local picture you carry in your head:
${waypointsPromptSummary()}

The Hudson here is a tidal estuary: the current floods north and ebbs south, and the classic danger is WIND AGAINST
CURRENT — a south wind over an ebb stacks steep chop. The verdict tools already encode this.

Rules — follow all of them, every turn:
1. VERDICT FIRST: any "can I paddle" question → call get_conditions_now (or find_paddle_windows for a future window)
   BEFORE any prose. Lead your prose with the verdict.
2. GROUNDING: never state a sensor number without historical context — call compare_to_history and cite the
   percentile or a nearest-analog day ("9,200 cfs — 38th percentile for July").
3. OFFER TO ACT: end every planning answer with EXACTLY ONE concrete offer — set a watch, log the trip, or compare
   another day. Never more than one.
4. DASHBOARDS: for open-ended analytics, call get_schema, then query_river_data, then render_dashboard. Narrate
   briefly between calls. Pass only data you actually queried.
5. If a tool returns { error }, explain briefly and retry ONCE with a corrected call.
6. If data is stale (dataAgeMinutes > 60), say so explicitly and answer from the latest stored rows.
7. Times shown to the user are Eastern (America/New_York). Today's date matters: reason about "Sunday" etc. from the
   current date in the conversation context.`;

export const kayakGuide = chat.agent({
  id: "kayak-guide",
  clientDataSchema: z.object({ userId: z.string(), email: z.string() }),
  tools: { ...dataTools, ...actionTools },
  run: async ({ messages, tools, signal }) => {
    return streamText({
      model: anthropic("claude-sonnet-4-6"),
      system: SYSTEM + `\n\nCurrent date/time: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} Eastern.`,
      messages,
      tools,
      abortSignal: signal,
      stopWhen: stepCountIs(8),
    });
  },
});
```

For this task, stub `actionTools` as `{}` inline (`const actionTools = {}`) and remove the import; Task 13 replaces it.

- [ ] **Step 3: Test the agent in the Trigger.dev playground**

```bash
npx trigger dev
```

Open the Trigger.dev dashboard → AI playground for `kayak-guide` (or trigger a run with a `submit-message` payload). Ask: *"Can I paddle tomorrow morning with a beginner?"*

Expected: the run streams; tool calls `get_conditions_now`, `find_paddle_windows`, `compare_to_history` appear in the trace; final prose leads with a verdict and ends with exactly one offer. Fix tool schema errors here before touching the frontend.

- [ ] **Step 4: Commit**

```bash
git add src/trigger/kayak-tools.ts src/trigger/kayak-guide.ts
git commit -m "feat: kayak-guide chat agent with grounded data tools

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Action Tools & `watch-trip`

**Files:**
- Create: `src/trigger/action-tools.ts`, `src/trigger/watch-trip.ts`
- Modify: `src/trigger/kayak-guide.ts` (restore the `actionTools` import from Task 12 Step 2)

**Interfaces:**
- Consumes: `chIngest` (Task 2), `assessAtTime` (Task 11), `getWatchStatus` (Task 11), `kayakGuide` type (Task 12).
- Produces:
  - `actionTools: ToolSet` — `log_trip`, `schedule_watch`, `cancel_watch`
  - Trigger task `watch-trip` (schema payload `{ watchId, chatId, userId, email, tripTime, baseline }`)
  - `setWatchStatus(watchId: string, row: {...}): Promise<void>` in `action-tools.ts` (ReplacingMergeTree upsert: re-insert full row with new status)

- [ ] **Step 1: Implement `src/trigger/action-tools.ts`**

```ts
import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { tasks, ai } from "@trigger.dev/sdk";
import { chIngest } from "@/lib/ch";
import { assessAtTime } from "@/lib/assess";
import { getRecentTrips } from "@/lib/queries";

const toEpoch = (s: string) => Math.floor(Date.parse(s) / 1000);

// ReplacingMergeTree(created_at) upsert: insert the full row again with a newer created_at.
export async function upsertWatch(row: {
  watch_id: string; user_id: string; chat_id: string; trip_time: number; email: string; status: string;
}): Promise<void> {
  await chIngest().insert({
    table: "watches",
    values: [{ ...row, created_at: Math.floor(Date.now() / 1000) }],
    format: "JSONEachRow",
  });
}

function identity(): { userId: string; email: string } {
  const cd = (ai.currentChatContext()?.clientData ?? {}) as { userId?: string; email?: string };
  return { userId: cd.userId ?? "anonymous", email: cd.email ?? "" };
}

export const actionTools = {
  log_trip: tool({
    description: "Log a completed paddle trip for the user. Returns a confirmation receipt.",
    inputSchema: z.object({
      started_at: z.string().describe("ISO 8601 datetime of launch"),
      route: z.string().describe("e.g. 'Hoboken Cove → Pier 66 and back'"),
      rating: z.enum(["calm", "choppy", "rough"]),
      notes: z.string().default(""),
    }),
    execute: async ({ started_at, route, rating, notes }) => {
      try {
        const { userId } = identity();
        const trip_id = randomUUID();
        await chIngest().insert({
          table: "trips",
          values: [{ trip_id, user_id: userId, started_at: toEpoch(started_at), route, rating, notes }],
          format: "JSONEachRow",
        });
        return { trip_id, route, rating, started_at, recentTripCount: (await getRecentTrips(userId)).length };
      } catch (e) { return { error: String(e) }; }
    },
  }),

  schedule_watch: tool({
    description:
      "Schedule a condition watch for a planned trip: re-checks the forecast at T-24h and T-3h and emails + posts in this chat if the safety outlook changes. Requires the user's email (from their profile) and the trip time.",
    inputSchema: z.object({ trip_time: z.string().describe("ISO 8601 planned launch time") }),
    execute: async ({ trip_time }) => {
      try {
        const { userId, email } = identity();
        if (!email) return { error: "No email on file — ask the user to set their email in the sidebar first." };
        const chatId = ai.currentChatContext()?.chatId ?? "";
        const watchId = randomUUID();
        const tripTs = toEpoch(trip_time);
        const baseline = (await assessAtTime(tripTs)).verdict.level;
        await upsertWatch({ watch_id: watchId, user_id: userId, chat_id: chatId, trip_time: tripTs, email, status: "active" });
        await tasks.trigger("watch-trip", { watchId, chatId, userId, email, tripTime: tripTs, baseline });
        return { watch_id: watchId, trip_time, baseline, email, checkpoints: ["T-24h", "T-3h"] };
      } catch (e) { return { error: String(e) }; }
    },
  }),

  cancel_watch: tool({
    description: "Cancel an active condition watch by id.",
    inputSchema: z.object({ watch_id: z.string() }),
    execute: async ({ watch_id }) => {
      try {
        const { userId, email } = identity();
        const chatId = ai.currentChatContext()?.chatId ?? "";
        // trip_time isn't needed for the status flip to matter; re-insert with status cancelled
        await upsertWatch({ watch_id, user_id: userId, chat_id: chatId, trip_time: 0, email, status: "cancelled" });
        return { watch_id, status: "cancelled" };
      } catch (e) { return { error: String(e) }; }
    },
  }),
};
```

**Verification note:** `ai.currentChatContext()` is the documented way to read `chatId`/`clientData` inside tool executes (`@trigger.dev/sdk` `ai.d.ts` line ~126). If clientData turns out to be unavailable in plain `tool()` executes, fall back to resolving tools per-turn via the `tools: (event) => ...` function form on `chat.agent` (event exposes `clientData`) and close over it. Check this in the playground before building the UI.

- [ ] **Step 2: Implement `src/trigger/watch-trip.ts`**

```ts
import { schemaTask, wait, tasks, logger } from "@trigger.dev/sdk";
import { z } from "zod";
import { Resend } from "resend";
import { assessAtTime } from "@/lib/assess";
import { getWatchStatus } from "@/lib/queries";
import { upsertWatch } from "./action-tools";
import type { Band } from "@/lib/types";

const eastern = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });

export const watchTrip = schemaTask({
  id: "watch-trip",
  schema: z.object({
    watchId: z.string(),
    chatId: z.string(),
    userId: z.string(),
    email: z.string(),
    tripTime: z.number(), // epoch seconds
    baseline: z.enum(["safe", "caution", "danger"]),
  }),
  maxDuration: 600, // durable waits don't count against duration
  run: async (p) => {
    const now = () => Math.floor(Date.now() / 1000);
    let checkpoints = [p.tripTime - 24 * 3600, p.tripTime - 3 * 3600].filter((t) => t > now() + 60);
    if (checkpoints.length === 0) checkpoints = [now() + 10]; // trip <3h away: one immediate check
    let last: Band = p.baseline;

    for (const cp of checkpoints) {
      await wait.until({ date: new Date(cp * 1000) });
      if ((await getWatchStatus(p.watchId)) === "cancelled") return { ended: "cancelled" };

      const { verdict, windKnots, currentKnots } = await assessAtTime(p.tripTime);
      logger.info("watch check", { cp, level: verdict.level, last });
      if (verdict.level !== last) {
        const direction = verdict.level === "safe" ? "improved" : "degraded";
        const summary = verdict.factors.map((f) => `${f.name}: ${f.detail} (${f.band})`).join(" · ");

        await new Resend(process.env.RESEND_API_KEY!).emails.send({
          from: process.env.ALERT_FROM_EMAIL!,
          to: p.email,
          subject: `KayakGuide: outlook ${direction} for your ${eastern(p.tripTime)} paddle — now ${verdict.level.toUpperCase()}`,
          html: `<p>The safety outlook for your planned paddle at <b>${eastern(p.tripTime)}</b> changed from <b>${last}</b> to <b>${verdict.level}</b>.</p><p>${summary}</p><p>Open your KayakGuide chat for details.</p>`,
        });

        // Inject a follow-up into the originating chat thread: deliver a message on the session.
        await tasks.trigger("kayak-guide", {
          chatId: p.chatId,
          trigger: "submit-message",
          message: {
            id: crypto.randomUUID(),
            role: "user",
            parts: [{
              type: "text",
              text: `[Watch update — automated] The outlook for my planned trip at ${eastern(p.tripTime)} changed from ${last} to ${verdict.level} (wind ${windKnots?.toFixed(0) ?? "?"} kt, current ${currentKnots?.toFixed(1) ?? "?"} kt). Give me the updated verdict and my options.`,
            }],
          },
          metadata: { userId: p.userId, email: p.email },
        });

        await upsertWatch({ watch_id: p.watchId, user_id: p.userId, chat_id: p.chatId, trip_time: p.tripTime, email: p.email, status: "alerted" });
        last = verdict.level;
      }
    }
    await upsertWatch({ watch_id: p.watchId, user_id: p.userId, chat_id: p.chatId, trip_time: p.tripTime, email: p.email, status: "completed" });
    return { ended: "completed", finalLevel: last };
  },
});
```

**Verification note:** the injection payload mirrors `ChatTaskWirePayload` (`chatId` + `message` + `trigger: "submit-message"`, clientData via `metadata`). Verify in the playground that a run triggered this way lands a turn on the existing session (sessions converge on `externalId`). If the direct trigger conflicts with a live suspended run, switch to `sessions.open(chatId).in.send(...)` with a chat-message record — check the record shape in `@trigger.dev/sdk` `chat.d.ts` (`ChatInputChunk`).

- [ ] **Step 3: Restore the import in `src/trigger/kayak-guide.ts`**

Replace the Task 12 stub `const actionTools = {}` with:

```ts
import { actionTools } from "./action-tools";
```

- [ ] **Step 4: End-to-end watch test with a compressed timeline**

With `npx trigger dev` running, in the playground tell the agent: *"I'm paddling in 2 hours, set a watch — my email is <your test email>."* (Set identity clientData in the playground if supported, else temporarily hardcode `identity()` fallback email.)

Expected: `schedule_watch` returns a receipt; a `watch-trip` run appears; because trip < 3h, it checks ~immediately; if the level differs from baseline nothing fires (correct) — to force an alert, temporarily pass `baseline: "danger"` when triggering `watch-trip` directly from the dashboard and confirm: Resend email arrives AND a new turn appears on the chat session. Revert any temporary hardcoding.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/action-tools.ts src/trigger/watch-trip.ts src/trigger/kayak-guide.ts
git commit -m "feat: trip logging, condition watches with Resend alerts and in-thread follow-ups

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Chat UI Shell (Transport, Identity, Text + Trace Rendering)

**Files:**
- Create: `src/app/actions.ts`, `src/components/Chat.tsx`, `src/components/Identity.tsx`, `src/components/ToolTrace.tsx`
- Modify: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes: `kayakGuide` task type (Task 12).
- Produces:
  - Server actions `startChatSession({ chatId, clientData })` and `mintChatToken()`
  - `<Chat chatId userId email />` rendering text parts + collapsible tool traces; rich renderers plug in via `renderPart` switch (Task 15 extends it)
  - localStorage identity (`kg_user` = `{ name, email }`), `userId` = name slugified; `chatId` persisted in `localStorage` (`kg_chat_id`) so the session survives refresh.

- [ ] **Step 1: Implement `src/app/actions.ts`**

```ts
"use server";

import { chat } from "@trigger.dev/sdk/ai";
import type { kayakGuide } from "@/trigger/kayak-guide";

export const startChatSession = chat.createStartSessionAction<typeof kayakGuide>("kayak-guide");

export async function mintChatToken(): Promise<string> {
  return chat.createAccessToken<typeof kayakGuide>("kayak-guide");
}
```

- [ ] **Step 2: Implement `src/components/Identity.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

export type UserIdentity = { name: string; email: string };

export function useIdentity(): [UserIdentity | null, (u: UserIdentity) => void] {
  const [id, setId] = useState<UserIdentity | null>(null);
  useEffect(() => {
    const raw = localStorage.getItem("kg_user");
    if (raw) setId(JSON.parse(raw));
  }, []);
  return [id, (u) => { localStorage.setItem("kg_user", JSON.stringify(u)); setId(u); }];
}

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
}

export function IdentityGate({ onSave }: { onSave: (u: UserIdentity) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form
      className="mx-auto mt-24 flex w-80 flex-col gap-3 rounded-xl border border-sky-900 bg-slate-900 p-6"
      onSubmit={(e) => { e.preventDefault(); if (name && email) onSave({ name, email }); }}
    >
      <h2 className="text-lg font-semibold text-sky-200">Welcome to KayakGuide</h2>
      <p className="text-sm text-slate-400">Name + email once — watches email you when conditions change.</p>
      <input className="rounded bg-slate-800 p-2 text-slate-100" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="rounded bg-slate-800 p-2 text-slate-100" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="rounded bg-sky-600 p-2 font-medium text-white hover:bg-sky-500">Start paddling</button>
    </form>
  );
}
```

- [ ] **Step 3: Implement `src/components/ToolTrace.tsx`**

```tsx
"use client";

import { useState } from "react";

const LABELS: Record<string, string> = {
  "tool-get_schema": "📖 Reading schema",
  "tool-query_river_data": "🔍 Ran a query",
  "tool-compare_to_history": "📊 Checked 16 years of history",
  "tool-get_conditions_now": "🌊 Fetched live conditions",
  "tool-find_paddle_windows": "🗓 Scanned for paddle windows",
  "tool-plan_round_trip": "🛶 Planned round trip",
  "tool-get_waypoints": "📍 Loaded local waypoints",
  "tool-cancel_watch": "🔕 Cancelled watch",
};

export function ToolTrace({ part }: { part: { type: string; state?: string; input?: unknown; output?: any } }) {
  const [open, setOpen] = useState(false);
  const label = LABELS[part.type] ?? `⚙️ ${part.type.replace("tool-", "")}`;
  const done = part.state === "output-available";
  const meta =
    done && part.output?.rowCount !== undefined
      ? ` — ${part.output.rowCount} rows in ${part.output.elapsedMs} ms`
      : done ? "" : " …";
  return (
    <div className="my-1 rounded border border-slate-800 bg-slate-900/60 text-xs text-slate-400">
      <button className="w-full px-2 py-1 text-left" onClick={() => setOpen(!open)}>
        {label}{meta}{part.output?.error ? " ⚠️ retried" : ""}
      </button>
      {open && (
        <pre className="max-h-48 overflow-auto border-t border-slate-800 p-2">
          {JSON.stringify({ input: part.input, output: part.output }, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/components/Chat.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import type { kayakGuide } from "@/trigger/kayak-guide";
import { startChatSession, mintChatToken } from "@/app/actions";
import { ToolTrace } from "./ToolTrace";

const SUGGESTED = [
  "Can I paddle Sunday morning with a beginner?",
  "Dashboard: this July vs the last 5 Julys",
  "Show me Hurricane Sandy at the Battery",
  "Log today's trip",
];

export function renderPart(part: any, i: number) {
  // Task 15 replaces the rich cases; shell renders text + traces only.
  if (part.type === "text") return <p key={i} className="whitespace-pre-wrap leading-relaxed">{part.text}</p>;
  if (part.type.startsWith("tool-")) return <ToolTrace key={i} part={part} />;
  return null;
}

export function Chat({ chatId, userId, email }: { chatId: string; userId: string; email: string }) {
  const [input, setInput] = useState("");
  const transport = useTriggerChatTransport<typeof kayakGuide>({
    task: "kayak-guide",
    accessToken: () => mintChatToken(),
    startSession: ({ chatId: cid }) => startChatSession({ chatId: cid, clientData: { userId, email } }),
    clientData: { userId, email },
  });
  const { messages, sendMessage, status } = useChat({ id: chatId, transport });
  const send = (text: string) => { if (text.trim()) { sendMessage({ text }); setInput(""); } };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-16 flex max-w-md flex-col gap-2">
            <p className="text-center text-slate-400">Ask about conditions, plan a trip, or explore 16 years of river data.</p>
            {SUGGESTED.map((s) => (
              <button key={s} className="rounded-lg border border-sky-900 bg-slate-900 p-3 text-left text-sm text-sky-200 hover:bg-slate-800" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[80%] rounded-xl bg-sky-800/60 p-3" : "max-w-[90%] rounded-xl bg-slate-900 p-3"}>
            {m.parts.map(renderPart)}
          </div>
        ))}
      </div>
      <form className="flex gap-2 border-t border-slate-800 p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input
          className="flex-1 rounded-lg bg-slate-800 p-3 text-slate-100 outline-none"
          placeholder="Ask about the river…" value={input} onChange={(e) => setInput(e.target.value)}
          disabled={status === "streaming"}
        />
        <button className="rounded-lg bg-sky-600 px-4 font-medium text-white disabled:opacity-50" disabled={status === "streaming"}>Send</button>
      </form>
    </div>
  );
}
```

**Verification note:** `useTriggerChatTransport` options (`task`, `accessToken`, `startSession`, `clientData`) come from `chat-react.d.ts` / `chat.d.ts` in `@trigger.dev/sdk` 4.5.4; if `clientData` isn't a transport option, pass it per-message via `sendMessage({ text }, { metadata: { userId, email } })` — check `TriggerChatTransportOptions` in `chat.d.ts` when wiring this up.

- [ ] **Step 5: Implement `src/app/page.tsx` (dark shell)**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { IdentityGate, useIdentity, slugify } from "@/components/Identity";

export default function Home() {
  const [identity, setIdentity] = useIdentity();
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => {
    let id = localStorage.getItem("kg_chat_id");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("kg_chat_id", id); }
    setChatId(id);
  }, []);

  return (
    <main className="flex h-screen bg-slate-950 text-slate-100">
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h1 className="font-semibold text-sky-300">🛶 KayakGuide <span className="text-xs text-slate-500">Hudson River</span></h1>
          {identity && (
            <button className="text-xs text-slate-500 hover:text-slate-300"
              onClick={() => { localStorage.removeItem("kg_chat_id"); location.reload(); }}>
              New chat
            </button>
          )}
        </header>
        {!identity ? (
          <IdentityGate onSave={setIdentity} />
        ) : chatId ? (
          <Chat chatId={chatId} userId={slugify(identity.name)} email={identity.email} />
        ) : null}
      </div>
      {/* Sidebar mounts here in Task 16 */}
    </main>
  );
}
```

Update `src/app/layout.tsx` metadata title to `KayakGuide — Hudson River paddling agent`; keep the scaffold body, add `className="bg-slate-950"`.

- [ ] **Step 6: Manual E2E of the shell**

Run both processes:

```bash
npx trigger dev          # terminal 1
npm run dev              # terminal 2
```

Open http://localhost:3000 → enter name/email → send "Can I paddle tomorrow morning?" Expected: streaming assistant text with collapsible trace rows for each tool call; refresh mid-answer → conversation resumes (durable session). Fix transport/auth issues now.

- [ ] **Step 7: Commit**

```bash
git add src/app src/components
git commit -m "feat: chat UI shell with durable Trigger transport, identity, and tool traces

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Rich Part Renderers (Verdict, Windows, Receipts, Dashboard)

**Files:**
- Create: `src/components/VerdictCard.tsx`, `src/components/WindowsTimeline.tsx`, `src/components/ReceiptCard.tsx`, `src/components/DashboardRenderer.tsx`
- Modify: `src/components/Chat.tsx` (the `renderPart` switch)

**Interfaces:**
- Consumes: tool part shapes produced in Tasks 12–13 — `assessNow()` output (verdict/factors/current/nextTides/dataAgeMinutes), `find_paddle_windows` output (`windows`, `tideMarkers`, `from`, `to`), `log_trip`/`schedule_watch` outputs, `render_dashboard` **input** spec.
- Produces: `renderPart` routing every rich tool part to its component; all other tools stay as `ToolTrace` rows.

- [ ] **Step 1: Implement `src/components/VerdictCard.tsx`**

```tsx
const STYLES = {
  safe: { ring: "border-green-500", bg: "bg-green-950/50", label: "🟢 GOOD TO PADDLE", text: "text-green-300" },
  caution: { ring: "border-yellow-500", bg: "bg-yellow-950/40", label: "🟡 CAUTION", text: "text-yellow-300" },
  danger: { ring: "border-red-500", bg: "bg-red-950/40", label: "🔴 STAY OFF THE WATER", text: "text-red-300" },
} as const;

export function VerdictCard({ output }: { output: any }) {
  if (!output?.verdict) return null;
  const s = STYLES[output.verdict.level as keyof typeof STYLES];
  return (
    <div className={`my-2 rounded-xl border-2 ${s.ring} ${s.bg} p-4`}>
      <div className={`text-lg font-bold ${s.text}`}>{s.label}</div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        {output.verdict.factors.map((f: any) => (
          <div key={f.name} className="rounded bg-slate-900/70 p-2">
            <div className="text-xs uppercase text-slate-500">{f.name}</div>
            <div className="font-medium">{f.detail}</div>
            <div className={STYLES[f.band as keyof typeof STYLES].text}>{f.band}</div>
          </div>
        ))}
      </div>
      {output.verdict.windOpposesCurrent && (
        <div className="mt-2 text-sm text-yellow-300">⚠ Wind against current — expect steep chop.</div>
      )}
      {output.dataAgeMinutes > 60 && (
        <div className="mt-1 text-xs text-slate-500">Data is {output.dataAgeMinutes} min old (live feeds may be down).</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `src/components/WindowsTimeline.tsx`**

Horizontal 48–72h strip: hours as flex cells colored by window level; tide H/L markers beneath.

```tsx
const et = (ts: number, opts: Intl.DateTimeFormatOptions) =>
  new Date(ts * 1000).toLocaleString("en-US", { timeZone: "America/New_York", ...opts });

export function WindowsTimeline({ output }: { output: any }) {
  if (!output?.windows) return null;
  const { from, to, windows, tideMarkers = [] } = output;
  const H = 3600;
  const hours: number[] = [];
  for (let t = from; t < to; t += H) hours.push(t);
  const levelAt = (ts: number) => windows.find((w: any) => ts >= w.start && ts < w.end)?.level ?? null;
  const color = (l: string | null) => (l === "safe" ? "bg-green-500" : l === "caution" ? "bg-yellow-500" : "bg-slate-800");

  return (
    <div className="my-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="mb-1 text-xs text-slate-400">
        Paddle windows · {et(from, { weekday: "short", month: "short", day: "numeric" })} → {et(to, { weekday: "short", month: "short", day: "numeric" })} (Eastern)
      </div>
      <div className="flex gap-px">
        {hours.map((ts) => (
          <div key={ts} className="flex-1">
            <div className={`h-6 rounded-sm ${color(levelAt(ts))}`} title={`${et(ts, { weekday: "short", hour: "numeric" })} — ${levelAt(ts) ?? "no-go"}`} />
            {new Date(ts * 1000).getUTCHours() % 6 === 0 && (
              <div className="mt-0.5 text-center text-[9px] text-slate-500">{et(ts, { hour: "numeric" })}</div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-sky-300">
        {tideMarkers.filter((t: any) => t.extreme === "H" || t.extreme === "L").map((t: any) => (
          <span key={t.ts}>{t.extreme === "H" ? "▲" : "▽"} {t.extreme} {et(t.ts, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
        ))}
      </div>
      {windows.length === 0 && <div className="mt-2 text-sm text-slate-400">No safe windows in this range.</div>}
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/components/ReceiptCard.tsx`**

```tsx
export function ReceiptCard({ kind, output }: { kind: "trip" | "watch"; output: any }) {
  if (!output || output.error) return null;
  return (
    <div className="my-2 w-72 rounded-lg border border-dashed border-sky-700 bg-slate-900 p-3 text-sm">
      <div className="font-semibold text-sky-300">{kind === "trip" ? "🛶 Trip logged" : "⏰ Watch scheduled"}</div>
      {kind === "trip" ? (
        <ul className="mt-1 text-slate-300">
          <li>{output.route}</li>
          <li>Conditions: {output.rating}</li>
          <li className="text-xs text-slate-500">id {String(output.trip_id).slice(0, 8)}</li>
        </ul>
      ) : (
        <ul className="mt-1 text-slate-300">
          <li>Trip: {new Date(Date.parse(output.trip_time)).toLocaleString("en-US", { timeZone: "America/New_York" })}</li>
          <li>Baseline outlook: {output.baseline}</li>
          <li>Re-checks at T-24h and T-3h → {output.email}</li>
          <li className="text-xs text-slate-500">id {String(output.watch_id).slice(0, 8)}</li>
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/components/DashboardRenderer.tsx`** (renders the tool **input**)

```tsx
"use client";

import { AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

const PIE_COLORS = ["#38bdf8", "#818cf8", "#f472b6", "#fbbf24", "#34d399"];

function Chart({ c }: { c: any }) {
  const common = { data: c.data, margin: { top: 4, right: 8, bottom: 4, left: 8 } };
  const axes = (
    <>
      <XAxis dataKey={c.xKey} stroke="#64748b" fontSize={10} />
      <YAxis stroke="#64748b" fontSize={10} width={44} />
      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
      {(c.annotations ?? []).map((a: any) => (
        <ReferenceLine key={String(a.x)} x={a.x} stroke="#f87171" label={{ value: a.label, fill: "#f87171", fontSize: 10 }} />
      ))}
    </>
  );
  switch (c.type) {
    case "area": return <AreaChart {...common}>{axes}<Area dataKey={c.yKey} stroke="#38bdf8" fill="#0c4a6e" /></AreaChart>;
    case "bar": return <BarChart {...common}>{axes}<Bar dataKey={c.yKey} fill="#38bdf8" /></BarChart>;
    case "line": return <LineChart {...common}>{axes}<Line dataKey={c.yKey} stroke="#38bdf8" dot={false} /></LineChart>;
    case "pie": return (
      <PieChart>
        <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
        <Pie data={c.data} dataKey={c.yKey} nameKey={c.xKey} label>
          {c.data.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
        </Pie>
      </PieChart>
    );
    default: return null;
  }
}

export function DashboardRenderer({ spec }: { spec: any }) {
  if (!spec?.charts && !spec?.cards) return null;
  return (
    <div className="my-2 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 font-semibold text-sky-300">{spec.title}</div>
      {spec.cards?.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {spec.cards.map((card: any) => (
            <div key={card.title} className="rounded-lg bg-slate-800 p-3">
              <div className="text-xs text-slate-400">{card.title}</div>
              <div className="text-xl font-bold text-slate-100">{card.value}</div>
              {card.subtitle && <div className="text-xs text-slate-500">{card.subtitle}</div>}
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {spec.charts?.map((c: any) => (
          <div key={c.title}>
            <div className="text-sm text-slate-300">{c.title}</div>
            {c.subtitle && <div className="text-xs text-slate-500">{c.subtitle}</div>}
            <ResponsiveContainer width="100%" height={180}><Chart c={c} /></ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the switch in `src/components/Chat.tsx`**

Replace `renderPart` with:

```tsx
import { VerdictCard } from "./VerdictCard";
import { WindowsTimeline } from "./WindowsTimeline";
import { ReceiptCard } from "./ReceiptCard";
import { DashboardRenderer } from "./DashboardRenderer";

export function renderPart(part: any, i: number) {
  if (part.type === "text") return <p key={i} className="whitespace-pre-wrap leading-relaxed">{part.text}</p>;
  if (!part.type.startsWith("tool-")) return null;
  const done = part.state === "output-available";
  switch (part.type) {
    case "tool-get_conditions_now":
      return done && !part.output?.error ? <VerdictCard key={i} output={part.output} /> : <ToolTrace key={i} part={part} />;
    case "tool-find_paddle_windows":
      return done && !part.output?.error ? <WindowsTimeline key={i} output={part.output} /> : <ToolTrace key={i} part={part} />;
    case "tool-log_trip":
      return done && !part.output?.error ? <ReceiptCard key={i} kind="trip" output={part.output} /> : <ToolTrace key={i} part={part} />;
    case "tool-schedule_watch":
      return done && !part.output?.error ? <ReceiptCard key={i} kind="watch" output={{ ...part.output, trip_time: part.input?.trip_time }} /> : <ToolTrace key={i} part={part} />;
    case "tool-render_dashboard":
      return part.input ? <DashboardRenderer key={i} spec={part.input} /> : <ToolTrace key={i} part={part} />;
    default:
      return <ToolTrace key={i} part={part} />;
  }
}
```

- [ ] **Step 6: Manual E2E of every renderer**

With both dev processes running, exercise each: *"Can I paddle Sunday morning with a beginner?"* (verdict + timeline), *"Show me Hurricane Sandy at the Battery"* (dashboard with area chart + surge annotation), *"Log today's trip — Hoboken to Pier 66, choppy"* (trip receipt), *"Watch my Sunday 9am trip"* (watch receipt). Expected: each rich card renders; failed tools fall back to trace rows.

- [ ] **Step 7: Commit**

```bash
git add src/components
git commit -m "feat: verdict card, paddle-window timeline, receipts, dashboard renderer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: Sidebar, Demo Seed, README & Deploy

**Files:**
- Create: `src/components/Sidebar.tsx`, `src/app/api/status/route.ts`, `scripts/seed-demo.ts`, `README.md`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `assessNow` (Task 11), `getRecentTrips` (Task 11).
- Produces: `GET /api/status` → `{ verdict, nextTides, current, trips }` (the one API route in the app — it serves the sidebar, not the chat, so the "no chat API routes" claim stands); deployed app + tasks; README with architecture diagram and hackathon compliance section.

- [ ] **Step 1: Implement `src/app/api/status/route.ts`**

```ts
import { NextResponse } from "next/server";
import { assessNow } from "@/lib/assess";
import { getRecentTrips } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get("userId") ?? "anonymous";
  try {
    const [now, trips] = await Promise.all([assessNow(), getRecentTrips(userId, 5)]);
    return NextResponse.json({ ...now, trips });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implement `src/components/Sidebar.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

const DOT = { safe: "bg-green-500", caution: "bg-yellow-500", danger: "bg-red-500" } as const;
const et = (ts: number) => new Date(ts * 1000).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });

export function Sidebar({ userId }: { userId: string }) {
  const [status, setStatus] = useState<any>(null);
  useEffect(() => {
    const load = () => fetch(`/api/status?userId=${userId}`).then((r) => r.json()).then(setStatus).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [userId]);

  return (
    <aside className="hidden w-64 flex-col gap-4 border-l border-slate-800 bg-slate-950 p-4 lg:flex">
      <div>
        <div className="text-xs uppercase text-slate-500">Right now</div>
        {status?.verdict ? (
          <div className="mt-1 flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full ${DOT[status.verdict.level as keyof typeof DOT]}`} />
            <span className="text-sm capitalize">{status.verdict.level}</span>
          </div>
        ) : <div className="text-sm text-slate-600">loading…</div>}
        {status?.current?.knots != null && (
          <div className="mt-1 text-xs text-slate-400">Current {Math.abs(status.current.knots).toFixed(1)} kt {status.current.phase}</div>
        )}
        {status?.readings?.wind_speed && (
          <div className="text-xs text-slate-400">Wind {status.readings.wind_speed.value.toFixed(0)} kt</div>
        )}
        {status?.nextTides?.map((t: any) => (
          <div key={t.ts} className="text-xs text-slate-500">{t.extreme === "H" ? "High" : "Low"} tide {et(t.ts)}</div>
        ))}
      </div>
      <div>
        <div className="text-xs uppercase text-slate-500">Recent trips</div>
        {(status?.trips ?? []).map((t: any) => (
          <div key={t.trip_id} className="mt-1 text-xs text-slate-400">{t.route} · {t.rating}</div>
        ))}
        {status?.trips?.length === 0 && <div className="text-xs text-slate-600">none yet — log one in chat</div>}
      </div>
    </aside>
  );
}
```

Mount it in `src/app/page.tsx` (replace the placeholder comment): `{identity && <Sidebar userId={slugify(identity.name)} />}`.

- [ ] **Step 3: Implement `scripts/seed-demo.ts`** (pre-stage demo data)

```ts
import { randomUUID } from "node:crypto";
import { chIngest } from "../src/lib/ch";

// Demo user's back-story trips, including two rated 'rough' for the OLTP+OLAP joint query scene.
const now = Math.floor(Date.now() / 1000);
const day = 86400;
const trips = [
  { route: "Hoboken Cove → Pier 66 loop", rating: "calm", notes: "glassy morning", started_at: now - 21 * day },
  { route: "Hoboken Cove → Weehawken Cove", rating: "choppy", notes: "ferry wakes on the return", started_at: now - 14 * day },
  { route: "Hoboken Cove → Pier 40", rating: "rough", notes: "south wind against the ebb, regretted it", started_at: now - 9 * day },
  { route: "Hoboken Cove → Intrepid", rating: "rough", notes: "gusts over 15, turned back early", started_at: now - 4 * day },
];

async function main() {
  await chIngest().insert({
    table: "trips",
    values: trips.map((t) => ({ trip_id: randomUUID(), user_id: "demo-paddler", ...t })),
    format: "JSONEachRow",
  });
  console.log(`seeded ${trips.length} demo trips for user demo-paddler`);
  await chIngest().close();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

```bash
npx tsx --env-file=.env scripts/seed-demo.ts
```

Expected: `seeded 4 demo trips for user demo-paddler`. (In the demo, sign in with name "Demo Paddler" → userId `demo-paddler`.)

- [ ] **Step 4: Write `README.md`**

Sections (write real content, not stubs): what it is (2 paragraphs); the architecture diagram from the spec §2 (copy the ASCII block verbatim); hackathon compliance (ClickHouse only DB — OLAP `readings`/`predictions` + OLTP `trips`/`watches` joined in single queries; Trigger.dev `chat.agent()` + cron + delayed runs; MIT; built July 17–23 2026); getting started (env vars table from `.env.example`, `npm run migrate`, `npm run seed:waypoints`, trigger `backfill-historical`, `npx trigger dev` + `npm run dev`); the five demo prompts; testing (`npm test`).

- [ ] **Step 5: Deploy**

```bash
npx trigger deploy         # tasks to Trigger.dev cloud
npx vercel --prod          # frontend to Vercel (set all .env vars in Vercel first, incl. TRIGGER_SECRET_KEY)
```

Verify on production: send "Can I paddle tomorrow?"; confirm `ingest-live` cron runs appear on the deployed environment; confirm the sidebar loads. Expected: same behavior as local.

- [ ] **Step 6: Full-suite check and commit**

```bash
npm test && npm run build
git add -A
git commit -m "feat: sidebar live status, demo seed, README, production deploy config

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Milestone Mapping (spec §10)

| Spec day | Plan tasks |
|----------|-----------|
| Jul 20 — scaffold, schema, ingest, NWS client, verdict fn, backfill started, waypoints | Tasks 1–8 |
| Jul 21 — agent + data tools + verdict/windows parts, round trip, basic chat UI | Tasks 9–12, 14 |
| Jul 22 — dashboards, trip logging, watch-trip + Resend + follow-up | Tasks 13, 15 |
| Jul 23 — polish, Sandy dry run, demo seed, README, video, submit | Task 16 + demo script (spec §8) |

## Out of Scope (from spec §11 — do not build)

Nationwide stations; auth/accounts/mobile/PWA; precipitation/temperature forecasts; HudsonFlow lessons/quizzes; storm-surge residual and moon-phase narration.
