const NOAA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
export type Reading = { stationId: string; source: "usgs" | "noaa"; parameter: string; ts: string; value: number };

export async function fetchUsgsReadings() {
  const url = new URL("https://waterservices.usgs.gov/nwis/iv/");
  url.search = new URLSearchParams({ format: "json", sites: "01335754,01377260", parameterCd: "00060,00065,00010", siteStatus: "all" }).toString();
  const json = await fetch(url, { headers: { "User-Agent": "KayakGuide/0.1" } }).then((r) => r.json());
  return json.value.timeSeries.flatMap((series: any) => series.values[0]?.value.map((v: any) => ({ stationId: series.sourceInfo.siteCode[0].value, source: "usgs", parameter: series.variable.variableCode[0].value === "00060" ? "discharge" : series.variable.variableCode[0].value === "00065" ? "gage_height" : "water_temp", ts: v.dateTime, value: Number(v.value) })) ?? []);
}

export async function fetchNoaaWind() {
  const url = new URL(NOAA);
  url.search = new URLSearchParams({ product: "wind", station: "8530973", date: "latest", time_zone: "lst_ldt", units: "english", format: "json", application: "kayak-guide" }).toString();
  const json = await fetch(url).then((r) => r.json());
  const item = json.data?.[0];
  if (!item) return [] as Reading[];
  return [{ stationId: "8530973", source: "noaa" as const, parameter: "wind_speed", ts: item.t, value: Number(item.s) }, { stationId: "8530973", source: "noaa" as const, parameter: "wind_gust", ts: item.t, value: Number(item.g) }, { stationId: "8530973", source: "noaa" as const, parameter: "wind_dir", ts: item.t, value: Number(item.d) }];
}

export async function fetchNwsHourlyWind() {
  const point = await fetch("https://api.weather.gov/points/40.7076,-74.0253", { headers: { "User-Agent": "KayakGuide/0.1" } }).then((r) => r.json());
  const forecast = await fetch(point.properties.forecastHourly, { headers: { "User-Agent": "KayakGuide/0.1" } }).then((r) => r.json());
  return forecast.properties.periods.map((p: any) => ({ ts: p.startTime, windKnots: Math.round(Number.parseFloat(p.windSpeed) * 0.868976), direction: p.windDirection }));
}

export type CurrentPrediction = { ts: string; knots: number; direction: "ebb" | "flood" };

export async function fetchCurrentPredictions(date: string): Promise<CurrentPrediction[]> {
  const compact = date.replaceAll("-", "");
  const url = new URL(NOAA);
  url.search = new URLSearchParams({
    product: "currents_predictions",
    station: "NYH1927",
    begin_date: compact,
    end_date: compact,
    time_zone: "lst_ldt",
    units: "english",
    interval: "60",
    format: "json",
    application: "kayak-guide",
  }).toString();
  const json = await fetch(url).then((r) => r.json());
  const items: any[] = json.current_predictions?.cp ?? [];
  return items.map((item) => {
    const velocity = Number(item.Velocity_Major);
    return { ts: item.Time, knots: Math.abs(velocity), direction: velocity < 0 ? "ebb" : "flood" };
  });
}
