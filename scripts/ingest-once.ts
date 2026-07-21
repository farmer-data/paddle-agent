// One-shot manual ingest — runs the same collection as the scheduled `ingest-live`
// Trigger task, but immediately, so ClickHouse can be seeded without waiting for cron.
//
//   node --env-file=.env --import tsx scripts/ingest-once.ts
//
import { insertReadings } from "../lib/clickhouse";
import { fetchCurrentNow, fetchNoaaWind, fetchUsgsReadings } from "../lib/sources";

async function main() {
  const [usgs, wind, current] = await Promise.all([
    fetchUsgsReadings(),
    fetchNoaaWind(),
    fetchCurrentNow().catch((error) => {
      console.warn("current fetch failed (continuing):", error instanceof Error ? error.message : error);
      return [] as Awaited<ReturnType<typeof fetchCurrentNow>>;
    }),
  ]);

  const readings = [...usgs, ...wind, ...current];
  await insertReadings(readings);
  console.log(`Inserted ${readings.length} readings:`, readings.map((r) => `${r.parameter}=${r.value}`).join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
