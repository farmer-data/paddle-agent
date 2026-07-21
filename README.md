# Paddle Agent

Paddle Agent is a safety-first Hudson River paddling guide. It combines live river conditions, tidal-current predictions, weather forecasts, and a paddler's trip history to answer questions such as:

- Can I paddle now?
- What is the best window in the next 48 hours?
- How does Sunday morning compare with trips I rated rough?
- Log today's Hoboken–Pier 66 paddle as rough.

The chat UI streams compact go/caution/no-go briefings alongside wind and current charts.

## Live demo

Try Paddle Agent at **[paddle-agent.vercel.app](https://paddle-agent.vercel.app/)**.

## How it works

```text
USGS + NOAA + NWS
        |
        v
Trigger.dev ingest task ----> ClickHouse
        |                         |
        +-------------------------+
                    |
                    v
          Trigger.dev AI agent
                    |
                    v
             Next.js chat UI
```

- **Next.js 16 + React 19** provide the chat interface.
- **Trigger.dev** runs the `paddle-agent` chat agent and the scheduled `ingest-live` task.
- **OpenAI `gpt-5-mini`** selects tools and writes the paddle briefing.
- **ClickHouse** stores sensor readings, predictions, trips, watches, and waypoints.
- **USGS, NOAA, and NWS** provide river, wind, current, and forecast data.

Live ingestion runs every 15 minutes. The agent can read current conditions, find forecast windows, execute guarded read-only analytics, save trips, and compare upcoming conditions with previously rough trips.

## Prerequisites

- Node.js 20 or newer
- A Trigger.dev project
- An OpenAI API key
- A ClickHouse database

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

3. Create the ClickHouse tables:

   ```bash
   clickhouse client --queries-file db/schema.sql
   ```

   If you use ClickHouse Cloud, run [`db/schema.sql`](db/schema.sql) through its SQL console or your preferred client.

4. Start Trigger.dev locally in one terminal:

   ```bash
   npm run dev:trigger
   ```

5. Start the web app in another terminal:

   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TRIGGER_SECRET_KEY` | Authenticates the app with Trigger.dev |
| `OPENAI_API_KEY` | Gives the agent access to the OpenAI model |
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint |
| `CLICKHOUSE_USERNAME` | ClickHouse user |
| `CLICKHOUSE_PASSWORD` | ClickHouse password |
| `CLICKHOUSE_DATABASE` | ClickHouse database name |
| `RESEND_API_KEY` | Optional watch-notification email delivery |
| `ALERT_FROM_EMAIL` | Optional sender used for watch notifications |

Never commit `.env`. It is ignored by Git.

## Useful commands

```bash
npm test                 # run the unit tests
npm run typecheck        # check TypeScript
npm run build            # create a production web build
npm run ingest:once      # fetch and store live readings once
npm run smoke:chat       # verify a deployed chat briefing
npm run smoke:trip       # verify trip logging end to end
npm run smoke:compare    # verify rough-trip comparison
```

## Deploy Trigger.dev tasks

The project reference and task directory are configured in [`trigger.config.ts`](trigger.config.ts). After authenticating the Trigger.dev CLI, deploy to Production with:

```bash
npx trigger deploy --env prod --env-file .env
```

The deployment includes these tasks:

- `paddle-agent` — streaming AI chat agent
- `ingest-live` — scheduled live-data ingestion
- `backfill-historical` — historical backfill scaffold

## Safety

Paddle Agent is a planning aid, not an official marine forecast or a substitute for local judgment. Check current weather, marine alerts, vessel traffic, equipment, and your own ability before launching.

## License

This project is licensed under the [MIT License](LICENSE).
