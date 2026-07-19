# RiverGuide — Design Doc

**Date:** 2026-07-19
**Target:** ClickHouse × Trigger.dev AI Hackathon 2026 (build window July 17–23, submission deadline July 23 midnight AoE)
**Working name:** RiverGuide (rename allowed at any point before submission)

## 1. Summary

RiverGuide is a chat agent for Hudson River paddlers. It answers planning questions ("Can I paddle Sunday morning with a beginner?") with traffic-light safety verdicts, visual paddle-window timelines, and agent-built dashboards — every claim grounded in years of historical USGS/NOAA data stored in ClickHouse. It also *acts*: it logs trips, schedules condition watches that re-check the forecast before a planned trip, emails the user if the outlook degrades, and posts follow-ups back into the chat thread.

It is the chat-agent evolution of HudsonFlow (existing Next.js dashboard at `/Users/hk/Desktop/0719/HudsonRiver`), reusing its domain knowledge (data sources, safety thresholds, plain-language philosophy) in a fresh repo.

**Hackathon compliance:**
- ClickHouse is the primary and only database (sensor time-series, predictions, trip logs, watches).
- Trigger.dev `chat.agent()` (v4.5+) orchestrates the conversation; Trigger.dev cron/delayed tasks handle ingestion and watches.
- New repo, MIT license, all code written inside the build window.
- Targets the grand prize and the "Best OLTP + OLAP" prize (transactional trip writes + analytical sensor reads in one database, joined in single queries).

## 2. Architecture

```
   USGS API ──┐     ┌─────────────────────────────┐
              ├──►  │  Trigger.dev                │ ──► ClickHouse Cloud
   NOAA API ──┘     │  • backfill-historical (1x) │      • readings      (OLAP time-series)
                    │  • ingest-live (cron 15min) │      • predictions   (tides/currents, 7d ahead)
                    │  • refresh-predictions (6h) │      • trips         (OLTP: user logs)
                    │  • river-guide chat.agent() │      • watches       (planned-trip monitors)
                    │  • watch-trip (delayed runs)│
                    └─────────────┬───────────────┘
                                  │ TriggerChatTransport        ┌──► Resend email alerts
                    ┌─────────────▼───────────────┐             │
                    │  Next.js chat UI (useChat)  │ ◄───────────┘ (alert also injected in thread)
                    └─────────────────────────────┘
```

**Stack:** Next.js (App Router, TypeScript), Vercel AI SDK `useChat` + `useTriggerChatTransport` (no API routes), Trigger.dev v4.5 `chat.agent()`, ClickHouse Cloud (free trial), Claude Sonnet via Anthropic API (`streamText`), Resend for email, Recharts for charts, Tailwind for styling. Deployed to Vercel (frontend) + Trigger.dev cloud (tasks).

## 3. Data Sources

Carried over from HudsonFlow:

| Source | Data | Station |
|--------|------|---------|
| USGS Water Services (`waterservices.usgs.gov/nwis/iv/`) | Discharge (cfs), gage height (ft), water temp where available | 01335754 (Hudson above Lock 1, Waterford NY) and 01377260 (Hudson at Pier 40, NY) |
| NOAA CO-OPS (`api.tidesandcurrents.noaa.gov`) | Tide predictions & verified water levels; current predictions | Tides: 8518750 (The Battery, NY). Currents: NYH1927_13 (Hudson River Entrance, 7 ft depth) |

Rate limits respected: NOAA 10 req/s; backfill chunked by year with per-chunk retry.

## 4. ClickHouse Schema

Database: ClickHouse Cloud. Two users: `ingest` (INSERT+SELECT, used by Trigger.dev tasks) and `agent_ro` (SELECT only, used by the agent's SQL tool).

```sql
-- OLAP core: sensor time-series (backfilled + live)
CREATE TABLE readings (
  station_id   LowCardinality(String),   -- '01335754', '8518750', ...
  source       LowCardinality(String),   -- 'usgs' | 'noaa'
  parameter    LowCardinality(String),   -- 'discharge','gage_height','water_temp','tide_observed','current_speed'
  ts           DateTime('America/New_York'),
  value        Float64
) ENGINE = ReplacingMergeTree            -- idempotent re-ingestion, no dupes
ORDER BY (station_id, parameter, ts);

-- NOAA predictions (tides + currents, future-dated)
CREATE TABLE predictions (
  station_id LowCardinality(String),
  kind       LowCardinality(String),     -- 'tide' | 'current'
  ts         DateTime('America/New_York'),
  value      Float64,
  extreme    LowCardinality(String)      -- 'H','L','slack','max_flood','max_ebb',''
) ENGINE = ReplacingMergeTree ORDER BY (station_id, kind, ts);

-- OLTP side: user trip logs, written via chat
CREATE TABLE trips (
  trip_id    UUID,
  user_id    String,
  started_at DateTime('America/New_York'),
  route      String,
  rating     LowCardinality(String),     -- 'calm','choppy','rough'
  notes      String,
  created_at DateTime DEFAULT now()
) ENGINE = MergeTree ORDER BY (user_id, started_at);

-- Watches: planned trips being monitored
CREATE TABLE watches (
  watch_id   UUID,
  user_id    String,
  chat_id    String,                     -- to inject follow-ups into the right thread
  trip_time  DateTime('America/New_York'),
  email      String,
  status     LowCardinality(String),     -- 'active','alerted','completed','cancelled'
  created_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(created_at) ORDER BY watch_id;
```

Backfill scope: ~10 years of 15-minute USGS instantaneous values for both stations (all available parameters) + NOAA verified water levels; expected volume 2–4M rows. Modest for ClickHouse but sufficient for honest percentile/analog queries.

## 5. Trigger.dev Tasks

| Task | Type | Behavior |
|------|------|----------|
| `backfill-historical` | one-off | Chunked by (station, parameter, year); each chunk fetches, parses, inserts; per-chunk retry. Idempotent via ReplacingMergeTree. |
| `ingest-live` | cron `*/15 * * * *` | Latest USGS readings + NOAA observations → `readings`. |
| `refresh-predictions` | cron `0 */6 * * *` | Next 7 days of NOAA tide + current predictions → `predictions`. |
| `river-guide` | `chat.agent()` | The conversation agent (Section 6). |
| `watch-trip` | delayed runs | Triggered by `schedule_watch` tool. Wakes at T-24h and T-3h before `trip_time`; re-runs safety assessment; if verdict changed (degraded or improved): send Resend email + inject follow-up message into the originating chat thread (`chat_id`); update `watches.status`. |

## 6. The Agent

One `chat.agent()` task, Claude Sonnet via `streamText`, tools declared in config.

### Data tools (ClickHouse reads via `agent_ro`)
- `get_conditions_now()` — latest readings + tide state + interpolated current speed, pre-joined; powers the verdict.
- `find_paddle_windows({ from, to, skill_level })` — scans `predictions` for slack/low-current windows, applies safety thresholds; returns structured windows rendered as `data-windows`.
- `compare_to_history({ metric, window })` — percentiles and nearest-analog days over backfilled data.
- `get_schema()` — table/column descriptions to ground the SQL tool (also yields the visible "Reading schema…" trace step).
- `query_river_data({ sql })` — guarded free-form SQL: read-only user, `SETTINGS max_result_rows=1000, readonly=1`, server-side timeout; returns rows + row count + elapsed ms (shown in the trace).

### Presentation tool
- `render_dashboard({ cards, charts })` — emits a `data-dashboard` part. No DB access; the agent passes data it already queried. Spec shape:
  - `cards: [{ title, value, subtitle }]`
  - `charts: [{ type: 'area'|'bar'|'line'|'pie', title, subtitle?, data, xKey, yKey, annotations?: [{ x, label }] }]`

### Action tools
- `log_trip({ started_at, route, rating, notes })` — INSERT into `trips`; emits `data-trip` confirmation card.
- `schedule_watch({ trip_time, email })` — INSERT into `watches` + trigger `watch-trip` with delayed runs; emits `data-watch` card.
- `cancel_watch({ watch_id })` — status update + cancel pending runs.

### Safety thresholds (from HudsonFlow, reused verbatim)
- Discharge (cfs): < 15,000 safe · 15,000–25,000 caution · > 25,000 danger
- Current speed (knots): < 1.5 safe · 1.5–2.5 caution · > 2.5 danger
- Combined verdict = worst of the two, adjusted by tide state; implemented as a pure function shared by the agent tools and the `watch-trip` task.

### Prompt strategy
1. **Persona:** experienced Hudson paddling guide — safety-first, not preachy, HCCB-aware, plain language ("data should serve people, not intimidate them").
2. **Grounding rule:** never state a number without historical context (percentile or nearest analog via `compare_to_history`).
3. **Verdict-first rule:** any "can I paddle" question → tools first, emit `data-verdict` before prose.
4. **Offer-to-act rule:** every planning answer ends with exactly one concrete offer (set a watch / log it / compare another day).
5. **Dashboard rule:** open-ended analytics → explore schema → query → `render_dashboard`, narrating briefly between tool calls.

### Error handling
- Tool failures return structured `{ error }`; the agent explains and retries once with a corrected call (SQL self-correction is visible in the trace and acceptable in the demo).
- If USGS/NOAA live APIs are down, fall back to latest ClickHouse rows and state data staleness explicitly.
- SQL guardrails: reject non-SELECT statements client-side before execution; row/time limits server-side.

## 7. Frontend

Single-page Next.js app, dark theme (water-blue accents from HudsonFlow's palette):

- **Chat pane:** `useChat` + `useTriggerChatTransport`. Durable session keyed on `chatId` (survives refresh).
- **Sidebar:** live mini-status (latest verdict, next tide, current speed) + recent trips — the app isn't empty before the first message.
- **Message part renderers:**
  - `data-dashboard` → generic `DashboardRenderer` (KPI cards; area/bar/line/pie Recharts; annotation markers)
  - `data-verdict` → traffic-light safety card (green/yellow/red + the 2–3 driving numbers)
  - `data-windows` → 48–72h horizontal timeline, safe windows in green, tide markers
  - `data-trip` / `data-watch` → receipt-style confirmation cards
  - Tool calls → collapsible trace rows ("🔍 Ran a query — N rows in X ms")
- **Empty-state suggested prompts** (double as the demo script): "Can I paddle Sunday morning?" · "Dashboard: this July vs. the last 5 Julys" · "Log today's trip".
- **Identity:** no auth. Name + email captured once in the UI, kept in localStorage, sent as `user_id`/`email`.

## 8. Demo Video Script (max 5 min)

1. **Story** (30s): HCCB kayaker; USGS/NOAA data too technical; meet RiverGuide.
2. **"Can I paddle Sunday with a beginner?"** (60s): verdict card → window timeline → historical grounding ("92nd percentile July discharge") → agent offers a watch.
3. **Accept the watch** (45s): Trigger.dev dashboard shows the delayed `watch-trip` run; Resend email arrives; follow-up message appears in-thread (pre-staged with a short delay for filming).
4. **"Dashboard of this month vs. history"** (60s): schema-exploration trace → SQL expand → dashboard render. The ClickHouse moment.
5. **Log a trip → "How does Sunday compare to trips I rated rough?"** (45s): the OLTP+OLAP joint-query moment.
6. **Close** (30s): architecture slide — Trigger.dev tasks + ClickHouse tables.

## 9. Testing

- **Unit:** safety-assessment and window-finding pure functions over fixture data; USGS/NOAA response parsers.
- **Integration:** each named ClickHouse query runs against a seeded test database (small fixture set).
- **Manual E2E:** chat flows, watch lifecycle, email delivery.
- No UI test suite (4-day scope).

## 10. Milestones (build window ends July 23 AoE)

| Day | Deliverable |
|-----|-------------|
| Jul 20 | Repo scaffold; ClickHouse Cloud provisioned; schema created; `ingest-live` + `refresh-predictions` running; backfill started |
| Jul 21 | Agent with data tools + verdict/windows parts; basic chat UI rendering all part types |
| Jul 22 | `render_dashboard` + generic renderer; trip logging; `watch-trip` + Resend + in-thread follow-up |
| Jul 23 | Polish, seed demo data, record video, write README, submit |

## 11. Out of Scope

- Nationwide station coverage (stretch only if everything lands early)
- Auth, user accounts, mobile app, PWA
- Weather/wind integration (mentioned as future work in README)
- Educational lessons/quizzes from HudsonFlow
