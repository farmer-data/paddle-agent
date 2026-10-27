# Paddle Agent public demo: simpler stack, two rivers, map — Design

**Date:** 2026-10-27
**Status:** Approved — implemented on branch public-demo
**Live site:** https://paddle-agent.vercel.app (stays on Vercel)

## Why

Paddle Agent becomes a public demo for **NYC paddlers who open the site, usually on a phone, to check whether today is safe to go out.** Today the app depends on Trigger.dev and a paid ClickHouse plan. Both go away. It also grows from one stretch of the Hudson into a map-based guide for the **Hudson and the East River**.

The audience is people using the live site, not developers cloning the repo. Polish, speed and trustworthy answers count for more than a zero-setup clone.

## Success

A paddler opens the site and, **within seconds and without typing**, sees:
- the verdict for their zone
- a short reason
- the best window today

The chat (Qwen) is for follow-ups: another day, a route, logging a trip.

## Goals

1. Remove Trigger.dev and ClickHouse completely, with no other paid service in their place. The only addition is one free-tier key-value store for chat rate-limit counters.
2. Swap the LLM from OpenAI to **Qwen** (the user's Qwen API key).
3. Cover six zones on the Hudson and East River, each with its own current station, wind forecast point and thresholds.
4. Verdicts default to a **first-season paddler**, with an "Experienced" switch.
5. Home screen is **layout A ("verdict first")**: see below and the mockup in `.superpowers/brainstorm/*/content/layout.html`.
6. Full map with coloured zones, launch pins, current and wind arrows, and a time slider.
7. Route planner on the map, also callable by the chat agent.
8. "My trips" stored in the visitor's browser, with conditions captured when each trip is logged.
9. Spending on the public chat is capped.

## Non-goals (first version)

- accounts or logins
- server-side storage of user data. The only server-side state is the chat rate-limit counters (see "Spending cap").
- email alerts or watches
- ferry or boat traffic
- waterways other than the Hudson and East River (no Harlem River, Upper Bay crossings or Jamaica Bay)
- float plans
- historical backfill
- the raw-SQL agent tool
- offline or installable app

## Anti-goals (failure even if it "works")

- **A confident 🟢 GO built on stale or missing data.** This is the worst outcome. See "No verdict" below.
- A route line on the map that reads as a promise that the route is safe.
- Strangers running up the Qwen bill.
- The map crowding out the instant answer. The verdict card stays first.

---

## Stack changes

| Remove | Replace with |
|---|---|
| `trigger/chat.ts`, `trigger.config.ts`, `app/actions.ts`, `@trigger.dev/sdk`, `trigger.dev`, `useTriggerChatTransport` | Next.js route handler `app/api/chat/route.ts` using AI SDK `streamText`, plus `useChat` with the default HTTP transport. Existing custom data parts (`data-paddle-briefing` etc.) are written with the AI SDK UI message stream writer. |
| `trigger/ingest.ts` (15-min cron into ClickHouse), `scripts/ingest-once.ts` | Fetch USGS, NOAA and NWS **on request** and lean on Next's fetch cache (TTLs below). No cron, no stored readings. |
| `lib/clickhouse.ts`, `db/schema.sql`, `@clickhouse/client` | Nothing on the server. Trips live in the browser (see "My trips"). |
| `query_river_data` tool | Deleted. |
| Watches, Resend env vars | Deleted. |
| `@ai-sdk/openai`, `gpt-5-mini` | Qwen through `@ai-sdk/openai-compatible` (Alibaba Model Studio / DashScope OpenAI-compatible endpoint). |

**Environment variables after the change:**
- `QWEN_API_KEY` (required)
- `QWEN_BASE_URL` (optional; defaults to the international endpoint `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`; the mainland China endpoint also works)
- `QWEN_MODEL` (optional; default `qwen-plus`, which can be swapped for any Qwen model with reliable tool calling)

The rate-limit store's own variables are added by its Marketplace integration.

All `TRIGGER_*`, `CLICKHOUSE_*`, `OPENAI_API_KEY`, `RESEND_API_KEY` and `ALERT_FROM_EMAIL` go away. `.env.example` and the README are updated to match.

**Builder's call:** whether to stay on AI SDK 6 (current) or move to 7. Pick whichever keeps the change smallest while supporting the openai-compatible provider and custom data parts.

---

## Zones

Six zones. Each zone has a name, a map shape (hand-drawn polygon or polyline is fine), a NOAA current-prediction station, an NWS forecast point (lat/lon at the zone's centre), and whether river flow applies. All six current stations were checked on 2026-10-27 and return hourly predictions with `interval=60`.

| Zone | Rough extent | NOAA current station | Today's peak (checked) | Uses Hudson flow? |
|---|---|---|---|---|
| Upper Hudson | Spuyten Duyvil to ~125th St | `HUR0611` George Washington Bridge | 3.2 kn | yes |
| Midtown Hudson | ~125th St to ~23rd St | `NYH1928` Hudson River, Pier 92 | 3.4 kn | yes |
| Lower Hudson | ~23rd St to the Battery, incl. Hoboken / Jersey City shore | `NYH1927` Hudson River Entrance (used today) | 2.7 kn | yes |
| Lower East River | Battery to the Williamsburg Bridge | `NYH1920` Brooklyn Bridge | 3.8 kn | no |
| Midtown East River | Williamsburg Bridge to Roosevelt Island's north tip | `NYH1922` Newtown Creek | 2.6 kn | no |
| Hell Gate | Roosevelt Island's north tip through Hell Gate | `NYH1924` Hell Gate | 5.4 kn | no |

Exact boundaries are the builder's call. Hudson flow is the existing USGS discharge gauge and thresholds (15,000 cfs caution, 25,000 cfs no-go), applied to Hudson zones only.

**Launch sites:** compile a hand-made list (name, lat/lon, zone, short note) of real public launches along both rivers. Starting candidates to verify: Dyckman St, Pier 96, Pier 84, Pier 40, Pier 26, Hoboken Cove, Brooklyn Bridge Park, Hallets Cove. Include only sites the builder can confirm are public launches. Each belongs to exactly one zone.

**Route landmarks:** a short list of non-launch destinations inside the six zones, such as Little Red Lighthouse, Intrepid, Brooklyn Bridge, Williamsburg Bridge, and Roosevelt Island lighthouse. The selection is the builder's.

## Verdict rules

The verdict is computed **per zone, per hour**. The user's mode (Beginner by default, or Experienced) picks the thresholds.

| Factor | Beginner 🟡 | Beginner 🔴 | Experienced 🟡 | Experienced 🔴 |
|---|---|---|---|---|
| Wind (kn) | ≥ 8 | > 12 | ≥ 12 | > 18 |
| Current (kn) | ≥ 1.0 | > 2.0 | ≥ 2.0 | > 3.0 |
| Hudson flow (cfs, Hudson zones only) | ≥ 15,000 | > 25,000 | same | same |
| Hell Gate zone | — | always | normal rules (so it's only open near slack) | |
| Small craft advisory, gale or storm warning, thunderstorm warning for the zone | — | always | — | always |
| Before sunrise / after sunset | — | always | — | always |
| Water below 60 °F | no colour change; card shows a required-gear line (see below) | — | same | — |

All numbers are **draft values agreed for now**. Keep them in one config object so they're easy to change.

- **Wind against current** raises the wind rating one level, as today. "Against" is now computed from each zone's own current direction: NOAA returns `meanEbbDir` and `meanFloodDir` per station. The test is that the wind's *from* direction is within ±45° of the current's *flow-toward* heading. This matches today's Hudson rule and works for the bent East River. Whether to skip this rule near slack (for example under 0.5 kn) is the builder's call.
- **Cold water** does **not** change the verdict colour. This was decided after review: a 🟡 rule would have ruled out 🟢 from about November to June. Instead:
  - When water is below 60 °F, the verdict card (and the agent's briefing) shows a required-gear line, e.g. "Water 52 °F — wetsuit or drysuit required". This applies in both modes.
  - If the water-temperature reading is unavailable or stale between **November 1 and June 30**, assume cold water and show the gear line anyway ("Water temperature unavailable — assume cold, wetsuit or drysuit required"). A sensor outage must never hide it.
- **Recent rain** does **not** change the verdict. It shows a separate water-quality badge ("Recent heavy rain — sewage overflow likely, avoid water contact") when the last 48 h total is ≥ 0.25 in. That threshold is a draft. Source is the builder's call, for example NWS observations at Central Park (KNYC) or Open-Meteo past precipitation.
- **Expected effect:** with beginner thresholds, the stations above exceed 2 kn for much of each tide. Beginner verdicts will often be 🟡 or 🔴 except around slack, and the "best window" will cluster near slack water. This is intended.

### Best window (my call)

- A **single 🟢 hour counts as a window.** This replaces today's `findBestWindow` behaviour, which needs at least two consecutive hours before falling back to 🟡. Near slack, beginner 🟢 runs will often be one hour long.
- The window is chosen within daylight: the longest 🟢 run, with ties going to the earliest.
- **If there is no 🟢 hour today,** the card says **"No 🟢 window today"**. If there is a 🟡 stretch, a second line reads "Least risky: 🟡 3–5 PM". A 🔴 hour is never suggested.
- `find_paddle_windows`, the route planner's suggested departure and the agent's wording all use this same rule.

### No verdict (replaces "missing = safe")

Today `band()` in `lib/safety.ts` returns `"safe"` when a value is missing. That must go.

- If any source that **can push the verdict to no-go** is missing, failed, or older than its max age, that hour shows a grey **"No verdict"** naming the source, e.g. "Couldn't reach NOAA currents". Those sources are wind, current, marine alerts, and Hudson flow for Hudson zones.
- Water temperature, rain and sunset are advisory. If they're unavailable, their chip says "unavailable" and the verdict stands, apart from the cold-season gear rule above. (My call.)
- Max ages are the builder's call within these bounds: observations ≤ 90 min old, NWS forecast ≤ 6 h old.

## Data sources and caching

| Data | Source | Cache TTL (suggested) |
|---|---|---|
| Hourly wind forecast per zone | NWS `points` → `forecastHourly` (existing pattern) | 30 min |
| Wind now | existing NOAA station `8530973` Robbins Reef, or NWS first hour, at the builder's choice. Note `8518750` The Battery returned no wind on 2026-10-27. | 10 min |
| Current per zone, per hour | NOAA `currents_predictions`, `interval=60`, station per zone (existing pattern) | 12 h (predictions are deterministic) |
| Hudson flow | existing USGS gauge | 15 min |
| Water temperature | NOAA `water_temperature` at `8518750` The Battery (verified working) | 30 min |
| Marine alerts | NWS `alerts/active` by zone point or marine zone (`ANZ338` New York Harbor verified; check which marine zone covers Hell Gate) | 5 min |
| Rain, last 48 h | builder's call (see above) | 30 min |
| Sunrise and sunset | computed locally (e.g. `suncalc`) | — |

One server endpoint (replacing `app/api/conditions/route.ts`) returns the **outlook for all six zones**: hourly verdicts and factors for the next 48 h, current-now values, alerts, water temperature, the rain badge and per-source health. It's used both by the home screen and the map. The shape is the builder's call.

---

## Screens

The visual style keeps today's palette and fonts (`app/globals.css`). The Longfellow verse and the Hoboken Cove Community Boathouse note move below the fold. The footer's "ClickHouse → Trigger.dev" pipeline is rewritten. (My call.)

### Home: layout A ("verdict first")

Top to bottom, on a phone:
1. **Top bar:** name, **Beginner ▾ / Experienced** switch, **zone picker** with a "Near me" option that uses browser location only when chosen, and "Updated N min ago". The zone defaults to the last picked (remembered in the browser), otherwise Lower Hudson.
2. **Alert banner:** red, only when a marine warning is active for the zone.
3. **Verdict card:**
   - 🟢 / 🟡 / 🔴 / grey "No verdict" in large type
   - a two-line plain-language reason
   - "🟢 Best today: 3–6 PM", or a clear "No safe window today"
4. **Hour strip:** coloured blocks from now until sunset. After sunset it shows tomorrow sunrise→sunset, labelled "Tomorrow". Tapping an hour updates the verdict card and chips for that hour.
5. **Chips:** 💨 wind (speed and from-direction), 🌊 current (speed, ebb/flood, next turn), 🌡 water temperature, 💧 rain badge, 🌅 sunset.
6. **Map preview:** the zone-coloured map, tap to open the full map.
7. **"Ask the guide" box:** pinned to the bottom. Tapping opens the chat as a sheet over the page, using the existing reply cards (briefing, timeline, trip saved, comparison).

On desktop it becomes two columns: map on the left, verdict and chat on the right.

### Full map

- **Map library:** MapLibre GL with a free, key-less tile source such as OpenFreeMap. (My call. Any free, no-key option is acceptable.)
- **Layers:**
  - zone shapes coloured by verdict for the selected hour
  - launch pins (tap → card with the zone verdict; "Set as my zone")
  - landmark pins
  - one current arrow per zone (direction and speed)
  - wind arrow(s)
- **Time slider** covering the next 48 h, shared with the hour strip's selected hour.
- **Entry point for the route planner.**

### Route planner

- **Input:**
  - a start (launch) and a destination (launch or landmark)
  - a departure time (default: next whole hour)
  - optionally "out and back" with a turnaround time
- **Routing:** follow a hand-built waterway graph, a polyline network along each river near the shore, joined around the Battery, using shortest path. Routes must never cross land, and Hudson ↔ East River trips go around the Battery. (My call. Tapping waypoints by hand is not needed for v1.)
- **Time model:**
  - simulate in 15-min steps
  - ground speed = paddling speed + the zone's predicted current projected onto the leg's bearing − a headwind penalty
  - Paddling speed is 2.5 kn for Beginner and 3.5 kn for Experienced; the headwind penalty is a draft constant. All numbers sit in the same config object.
  - If ground speed drops below 0.5 kn, flag "you won't make headway here".
- **Output:**
  - distance, estimated time, ETA
  - the worst verdict along the route over the paddle's duration
  - the route line coloured by verdict per segment
  - a suggested departure within today's daylight that minimises time while staying out of 🔴 (preferring all 🟢)
- **Hell Gate in Beginner mode:** any route entering the zone is drawn red, says "Not for first-season paddlers", and gets no suggested departure.
- **River crossings** (decided after review). Some launches sit across the water from Manhattan, such as Hoboken Cove and Brooklyn Bridge Park, and ferries aren't shown.
  - The waterway graph has **near-shore lines on both banks** of each river, joined by a few **crossing edges** at the narrowest sensible points. Exact crossing points are the builder's call.
  - **Beginner:** routes stay on the start launch's own shore. If the destination can only be reached by crossing, the route is drawn red, says "Crosses a ferry lane — not for first-season paddlers", and gets no suggested departure, the same treatment as Hell Gate.
  - **Experienced:** crossings are allowed only on crossing edges. Each crossing segment carries a "Ferry lane — cross quickly, look both ways, cross at a right angle" warning.
- **Safety copy:** every route result carries a one-line reminder that this is a planning estimate, not a safe-passage guarantee.

### My trips

- Stored in `localStorage` in the visitor's browser. Losing them on another device is accepted for a demo.
- Each trip: id, route text, zone, rating (calm / moderate / rough), notes, start time, and a **conditions snapshot** (wind, wind direction, current, current phase, verdict at that time).
- The snapshot is computed by the server when the trip is logged:
  - **trip now:** the current outlook
  - **past trip:** NOAA observed wind history for that time plus that day's current predictions
  - If no snapshot is possible, the trip is saved without one and excluded from comparisons.
- **Screen:** a simple list (sheet or page) with delete, plus trip pins on the map coloured by rating.
- **Rough-trip comparison:** compares an upcoming window's forecast with the median wind and current of the visitor's trips rated rough. It replaces the ClickHouse cross-join.

---

## The guide (chat agent)

- **Endpoint:** `app/api/chat/route.ts`. It streams via the AI SDK with Qwen, tools, `stopWhen` step cap (4, as today) and `maxOutputTokens` (1200, as today).
- **The client sends with each request:**
  - the selected zone
  - the mode (beginner/experienced)
  - the visitor's trips (snapshot fields only, max 50)
  - the last ~12 messages
- **Tools** (all zone-aware; zone defaults to the selected one):
  - `get_conditions(zone?, hour?)`: verdict and factors; writes `data-paddle-briefing`
  - `find_paddle_windows(zone?, hours?)`: per zone, using the "Best window" rule above
  - `plan_route(from, to, depart?, outAndBack?)`: runs the route planner; writes a new `data-paddle-route` part. The client draws it and opens the map.
  - `log_trip(route, rating, notes?, started_at?, zone?)`: computes the snapshot and writes `data-paddle-trip`. **The client saves it to localStorage.** The server stores nothing.
  - `compare_rough_trips(when, zone?)`: uses the trips sent with the request; writes `data-paddle-comparison`
- **System prompt:** keep today's briefing format and tone (🟢/🟡/🔴, WHY IT MATTERS, BEST MOVE, NEXT ACTION, under 160 words, never invent numbers). Generalise it from "Hoboken/NY Harbor" to the selected zone and mode. Add the Hell Gate / beginner rule and the route-estimate caveat. Expect to retune wording for Qwen.
- **Chat history:** kept in page state only and not persisted. (My call.)

## Spending cap on the public chat

Required before going live:
- **per-visitor limits** on `/api/chat`: **20 messages per hour and 50 per day per IP** (draft)
- a **site-wide ceiling**: **500 chat messages per day** across all visitors (draft). This is the real cap on the Qwen bill.
- a max length on user messages (~500 characters)
- only the last ~12 messages sent to the model
- the existing step and token caps

**Mechanism (decided after review):** one **free-tier key-value store from the Vercel Marketplace** (e.g. Redis-compatible). It holds only rate-limit counters with expiry, never user data, and requires no paid plan.
- When planning, load the Vercel `marketplace` skill and use its discovery to pick and provision the store. Don't hard-code a provider beforehand.
- The store's environment variables are added by the integration.
- Vercel's firewall (`checkRateLimit`) and BotID can optionally sit in front as burst and bot protection. They're the builder's call.

**Behaviour:**
- Limits are checked **before** the model is called.
- When a visitor hits a limit, the chat says so politely and says when it resets. When the site-wide ceiling is hit, it says the guide is resting until tomorrow.
- If the counter store is unreachable, the chat **fails closed** ("The guide is unavailable right now") rather than running unmetered. (My call.)
- The home screen, map and route planner keep working in every case, because none of them call the LLM.

## Testing and verification

- Unit tests (Vitest, existing setup) for:
  - verdict rules, both modes
  - missing or stale data → no verdict
  - wind-against-current for Hudson and East River headings
  - zone lookup for launch sites
  - route graph never crossing land, and the time model
  - Hell Gate and river-crossing behaviour in Beginner mode
  - the cold-water gear line, including a missing reading in the cold season
  - best-window selection, including single 🟢 hours and the "No 🟢 window today" case
  - rate-limit checks, including failing closed
- Existing tests (`windows`, `when`, `sources`, `briefing`) updated or retired as their modules change.
- Smoke scripts rewritten against `/api/chat` (local or deployed URL):
  - "Can I paddle now?"
  - log a trip
  - compare rough trips (with trips in the request body)
  - plan a route
  
  These double as the check that the chosen Qwen model calls tools reliably.
- Manual check on a phone-width viewport before deploy.

## Left to the builder

- exact zone boundaries and shapes, and the river-crossing points
- the launch and landmark lists (real sites only)
- the waterway graph
- the AI SDK version
- the rain source
- the wind-now source
- cache details
- outlook payload shape
- which free Marketplace store to use for the counters (via the `marketplace` skill), and whether to add firewall or BotID in front
- component structure
- whether to skip wind-against-current near slack
