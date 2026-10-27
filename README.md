# Paddle Agent

Paddle Agent is a safety-first, phone-first paddling guide for New York City. It covers six zones on the Hudson and East River and answers one question first: is it safe to paddle today?

- A verdict-first home screen shows the verdict for your zone, a short reason, and the best window today.
- A map shows the zones, launch pins, current and wind arrows, a time slider, and a route planner.
- "My trips" are stored in your browser, with the conditions captured when you log each trip.
- A chat guide handles follow-ups: another day, a route, logging a trip.

Verdicts default to a first-season paddler, with an "Experienced" switch.

## Live demo

Try Paddle Agent at **[paddle-agent.vercel.app](https://paddle-agent.vercel.app/)**.

## How it works

```text
USGS + NOAA + NWS + Open-Meteo
              |
              v
   /api/outlook (cached fetches)
              |
              v
   verdict engine in the browser

browser --> /api/chat (rate-limited) --> Qwen with tools
```

- **Next.js 16 + React 19** serve the app and the two API routes.
- **MapLibre GL** draws the map. Its worker is copied into `public/maplibre/` by `scripts/copy-maplibre-worker.mjs` on `postinstall`, `predev` and `prebuild`.
- **USGS, NOAA, NWS and Open-Meteo** provide river, current, wind, and forecast data. `/api/outlook` fetches them on request and relies on Next's fetch cache. There is no cron and no stored readings.
- **Qwen** (through the AI SDK's OpenAI-compatible provider) selects tools and writes follow-up answers.
- **A free counter store** holds chat rate-limit counters. It is the only server-side state; trips never leave the browser.

## Prerequisites

- Node.js 22 or newer
- A Qwen API key (Alibaba Model Studio)
- For production: a free Redis-compatible store from the Vercel Marketplace, used for chat rate-limit counters

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template to `.env.local` and add your Qwen API key:

   ```bash
   cp .env.example .env.local
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000).

In development the chat rate limit uses an in-memory counter automatically, so no store is needed.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `QWEN_API_KEY` | Qwen API key. Required for the chat. |
| `QWEN_BASE_URL` | OpenAI-compatible endpoint. Defaults to `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`. For mainland China use `https://dashscope.aliyuncs.com/compatible-mode/v1`. Token Plan and other OpenAI-compatible Model Studio endpoints also work. |
| `QWEN_MODEL` | Model name. Defaults to `qwen-plus`, which is not available on every endpoint: set this to a model your endpoint offers. Live chat was verified end to end with `qwen3.8-max` on a Model Studio Token Plan endpoint. |
| Counter store variables | Added by the store's Vercel Marketplace integration; pull them locally with `vercel env pull`. |

### Chat rate-limit store

In production the chat stays off ("The guide is unavailable right now") until a free Redis-compatible store from the Vercel Marketplace is connected. Without a store the chat fails closed rather than running unmetered. The rest of the app does not depend on it.

Never commit `.env.local`. It is ignored by Git.

## Useful commands

```bash
npm test                 # run the unit tests
npm run typecheck        # check TypeScript
npm run build            # create a production web build
npm run smoke            # four end-to-end chat checks against a running server
```

`npm run smoke` reads `.env.local` and targets `SMOKE_URL` (default `http://localhost:3000`):

```bash
SMOKE_URL=https://your-preview.vercel.app npm run smoke
```

## Safety

Paddle Agent is a planning aid, not an official marine forecast or a substitute for local judgment. Check current weather, marine alerts, vessel traffic, equipment, and your own ability before launching.

Thresholds are draft values for first-season paddlers; see `lib/config.ts`.

## License

This project is licensed under the [MIT License](LICENSE).
