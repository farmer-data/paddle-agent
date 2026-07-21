import { roughTripComparison } from "../lib/clickhouse";
import { forecastForWindow } from "../lib/forecast";

async function main() {
  console.log("=== roughTripComparison (trips ⋈ readings, ClickHouse) ===");
  const rough = await roughTripComparison();
  console.log("stats:", rough.stats);
  console.log("trips:", rough.trips);

  console.log("\n=== forecastForWindow('Sunday morning') ===");
  const forecast = await forecastForWindow("Sunday morning");
  console.log(forecast);

  if (forecast.available && rough.stats.rough_trips > 0) {
    const delta = forecast.windKnots - rough.stats.median_wind;
    console.log(
      `\n${forecast.label} forecast wind ${forecast.windKnots.toFixed(1)} kn vs ${rough.stats.median_wind.toFixed(1)} kn median across ${rough.stats.rough_trips} rough trips` +
        (forecast.opposingWind ? " — wind opposing the ebb increases risk." : "."),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
