// Verify tidal-current readings in ClickHouse. Prints the most recent current_speed /
// current_dir rows so you can confirm ingest (manual or scheduled) is landing data.
//
//   node --env-file=.env --import tsx scripts/verify-current.ts
//
import { query } from "../lib/clickhouse";

async function main() {
  const rows = await query<{ parameter: string; value: number; ts: string }>(
    "SELECT parameter, value, toString(ts) AS ts FROM readings WHERE parameter IN ('current_speed','current_dir') ORDER BY ts DESC LIMIT 8",
  );
  console.log(`current rows (most recent first): ${rows.length}`);
  for (const r of rows) console.log(`  ${r.ts}  ${r.parameter} = ${r.value}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
