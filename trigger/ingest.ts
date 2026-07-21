import { schedules, task } from "@trigger.dev/sdk";
import { insertReadings } from "../lib/clickhouse";
import { fetchCurrentNow, fetchNoaaWind, fetchUsgsReadings } from "../lib/sources";

export const ingestLive = schedules.task({
  id: "ingest-live",
  cron: "*/15 * * * *",
  run: async () => {
    // Tidal current has no observed feed; fetchCurrentNow supplies the NOAA harmonic
    // prediction for the current instant. Best-effort so a NOAA outage never stalls ingest.
    const [usgs, wind, current] = await Promise.all([
      fetchUsgsReadings(),
      fetchNoaaWind(),
      fetchCurrentNow().catch(() => [] as Awaited<ReturnType<typeof fetchCurrentNow>>),
    ]);
    await insertReadings([...usgs, ...wind, ...current]);
    return { readings: usgs.length + wind.length + current.length };
  },
});

export const backfillHistorical = task({
  id: "backfill-historical",
  run: async ({ from, to }: { from: string; to: string }) => ({ from, to, note: "Use yearly, idempotent source requests before enabling production backfill." }),
});
