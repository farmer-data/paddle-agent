import type { LonLat } from "./zones";
import { nyParts } from "./time";

const NOAA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
export type Reading = { stationId: string; source: "usgs" | "noaa"; parameter: string; ts: string; value: number };

export async function fetchUsgsReadings() {
  const url = new URL("https://waterservices.usgs.gov/nwis/iv/");
  url.search = new URLSearchParams({ format: "json", sites: "01335754,01377260", parameterCd: "00060,00065,00010", siteStatus: "all" }).toString();
  const json = await fetch(url, { headers: { "User-Agent": "PaddleAgent/0.1" } }).then((r) => r.json());
  return json.value.timeSeries.flatMap((series: any) => series.values[0]?.value.map((v: any) => ({ stationId: series.sourceInfo.siteCode[0].value, source: "usgs", parameter: series.variable.variableCode[0].value === "00060" ? "discharge" : series.variable.variableCode[0].value === "00065" ? "gage_height" : "water_temp", ts: v.dateTime, value: Number(v.value) })) ?? []);
}

export async function fetchNoaaWind() {
  const url = new URL(NOAA);
  url.search = new URLSearchParams({ product: "wind", station: "8530973", date: "latest", time_zone: "lst_ldt", units: "english", format: "json", application: "paddle-agent" }).toString();
  const json = await fetch(url).then((r) => r.json());
  const item = json.data?.[0];
  if (!item) return [] as Reading[];
  return [{ stationId: "8530973", source: "noaa" as const, parameter: "wind_speed", ts: item.t, value: Number(item.s) }, { stationId: "8530973", source: "noaa" as const, parameter: "wind_gust", ts: item.t, value: Number(item.g) }, { stationId: "8530973", source: "noaa" as const, parameter: "wind_dir", ts: item.t, value: Number(item.d) }];
}

export async function fetchNwsHourlyWind() {
  const point = await fetch("https://api.weather.gov/points/40.7076,-74.0253", { headers: { "User-Agent": "PaddleAgent/0.1" } }).then((r) => r.json());
  const forecast = await fetch(point.properties.forecastHourly, { headers: { "User-Agent": "PaddleAgent/0.1" } }).then((r) => r.json());
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
    application: "paddle-agent",
  }).toString();
  const json = await fetch(url).then((r) => r.json());
  const items: any[] = json.current_predictions?.cp ?? [];
  return items.map((item) => {
    const velocity = Number(item.Velocity_Major);
    return { ts: item.Time, knots: Math.abs(velocity), direction: velocity < 0 ? "ebb" : "flood" };
  });
}

// Live "now" tidal current for ingestion: the NOAA harmonic prediction nearest to the
// current instant. There is no observed-current feed, so this is the source of truth for
// the `current_speed` / `current_dir` readings. `current_dir` is the flow-toward compass
// heading (ebb ~183° south, flood ~11° north), mirroring how `wind_dir` is stored.
export async function fetchCurrentNow(now: Date = new Date()): Promise<Reading[]> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const compact = `${part("year")}${part("month")}${part("day")}`;
  const nowMs = Date.parse(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:00`);

  const url = new URL(NOAA);
  url.search = new URLSearchParams({
    product: "currents_predictions",
    station: "NYH1927",
    begin_date: compact,
    end_date: compact,
    time_zone: "lst_ldt",
    units: "english",
    interval: "6",
    format: "json",
    application: "paddle-agent",
  }).toString();
  const json = await fetch(url).then((r) => r.json());
  const items: any[] = json.current_predictions?.cp ?? [];
  if (!items.length) return [];
  const distance = (item: any) => Math.abs(Date.parse(item.Time.replace(" ", "T")) - nowMs);
  const nearest = items.reduce((best, item) => (distance(item) < distance(best) ? item : best));
  const velocity = Number(nearest.Velocity_Major);
  const heading = velocity < 0 ? Number(nearest.meanEbbDir) : Number(nearest.meanFloodDir);
  return [
    { stationId: "NYH1927", source: "noaa", parameter: "current_speed", ts: nearest.Time, value: Math.abs(velocity) },
    { stationId: "NYH1927", source: "noaa", parameter: "current_dir", ts: nearest.Time, value: heading },
  ];
}

// ---- v2 zone-aware fetchers: each throws on a non-OK response or malformed payload ----

export const DIRECTION_DEGREES: Record<string, number> = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };

export type CurrentPoint = { ts: string; signed: number; towardDeg: number };
export type WindPeriod = { ts: string; windKnots: number; fromDeg: number; direction: string };
export type Alert = { event: string; endsAt: string | null };

const HEADERS = { "User-Agent": "PaddleAgent/0.2" };

async function getJson(url: string | URL, revalidate: number): Promise<any> {
  const res = await fetch(url, { headers: HEADERS, next: { revalidate } });
  if (!res.ok) throw new Error(`${new URL(String(url)).host} responded ${res.status}`);
  return res.json();
}

const noaaUrl = (params: Record<string, string>) => {
  const url = new URL(NOAA);
  url.search = new URLSearchParams({ time_zone: "lst_ldt", units: "english", format: "json", application: "paddle-agent", ...params }).toString();
  return url;
};

export async function fetchHourlyWind(p: LonLat): Promise<{ periods: WindPeriod[]; updatedAt: string }> {
  const point = await getJson(`https://api.weather.gov/points/${p[1]},${p[0]}`, 86400);
  const hourlyUrl = point?.properties?.forecastHourly;
  if (typeof hourlyUrl !== "string") throw new Error("NWS points: no forecastHourly");
  const forecast = await getJson(hourlyUrl, 1800);
  const raw = forecast?.properties?.periods;
  if (!Array.isArray(raw)) throw new Error("NWS hourly: no periods");
  const periods = raw.map((x: any): WindPeriod => {
    const mph = Math.max(...(String(x.windSpeed).match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
    const fromDeg = DIRECTION_DEGREES[x.windDirection];
    if (!Number.isFinite(mph) || fromDeg === undefined) throw new Error("NWS hourly: unreadable wind");
    return { ts: x.startTime, windKnots: Math.round(mph * 0.868976), fromDeg, direction: x.windDirection };
  });
  return { periods, updatedAt: String(forecast.properties.updateTime) };
}

export async function fetchCurrentSeries(station: string, date: string): Promise<CurrentPoint[]> {
  const compact = date.replaceAll("-", "");
  const json = await getJson(noaaUrl({ product: "currents_predictions", station, begin_date: compact, end_date: compact, interval: "60" }), 43200);
  const items = json?.current_predictions?.cp;
  if (!Array.isArray(items)) throw new Error(`NOAA currents ${station}: no data`);
  return items.map((item: any): CurrentPoint => {
    const signed = Number(item.Velocity_Major);
    const toward = signed < 0 ? item.meanEbbDir : item.meanFloodDir;
    const towardDeg = toward === null || toward === undefined || toward === "" ? NaN : Number(toward);
    if (item.Velocity_Major === null || item.Velocity_Major === "" || !Number.isFinite(signed) || !Number.isFinite(towardDeg)) throw new Error(`NOAA currents ${station}: bad point at ${item.Time}`);
    return { ts: item.Time, signed, towardDeg };
  });
}

export async function fetchDischarge(): Promise<{ cfs: number; at: string }> {
  const url = new URL("https://waterservices.usgs.gov/nwis/iv/");
  url.search = new URLSearchParams({ format: "json", sites: "01335754", parameterCd: "00060", siteStatus: "all" }).toString();
  const json = await getJson(url, 900);
  const values = json?.value?.timeSeries?.[0]?.values?.[0]?.value;
  const last = Array.isArray(values) ? values[values.length - 1] : undefined;
  const cfs = Number(last?.value);
  if (!last || last.value === "" || !Number.isFinite(cfs)) throw new Error("USGS discharge: no data");
  return { cfs, at: last.dateTime };
}

export async function fetchWaterTemp(): Promise<{ f: number; at: string }> {
  const json = await getJson(noaaUrl({ product: "water_temperature", station: "8518750", date: "latest" }), 1800);
  const item = json?.data?.[0];
  const f = Number(item?.v);
  if (!item || item.v === "" || !Number.isFinite(f)) throw new Error("NOAA water temperature: no data");
  return { f, at: item.t };
}

export async function fetchAlerts(p: LonLat): Promise<Alert[]> {
  const json = await getJson(`https://api.weather.gov/alerts/active?point=${p[1]},${p[0]}`, 300);
  if (!Array.isArray(json?.features)) throw new Error("NWS alerts: malformed payload");
  return json.features.map((f: any): Alert => ({ event: f.properties.event, endsAt: f.properties.ends ?? f.properties.expires ?? null }));
}

export async function fetchRain48h(now: Date): Promise<number> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({ latitude: "40.75", longitude: "-73.99", hourly: "precipitation", past_days: "2", forecast_days: "1", precipitation_unit: "inch", timezone: "America/New_York" }).toString();
  const json = await getJson(url, 1800);
  const time: unknown = json?.hourly?.time;
  const precip: unknown = json?.hourly?.precipitation;
  if (!Array.isArray(time) || !Array.isArray(precip)) throw new Error("Open-Meteo: no hourly precipitation");
  const { date, hour } = nyParts(now);
  const end = time.indexOf(`${date}T${String(hour).padStart(2, "0")}:00`);
  if (end < 47) throw new Error("Open-Meteo: current hour outside returned window");
  const window = precip.slice(end - 47, end + 1);
  if (window.length !== 48 || window.some((v) => typeof v !== "number" || !Number.isFinite(v))) throw new Error("Open-Meteo: incomplete precipitation window");
  return (window as number[]).reduce((a, b) => a + b, 0);
}

export async function fetchWindHistory(date: string): Promise<{ ts: string; knots: number; fromDeg: number }[]> {
  const compact = date.replaceAll("-", "");
  const json = await getJson(noaaUrl({ product: "wind", station: "8530973", begin_date: compact, end_date: compact }), 86400);
  if (!Array.isArray(json?.data)) throw new Error("NOAA wind: no data");
  return json.data.map((d: any) => {
    const knots = Number(d.s), fromDeg = Number(d.d);
    if (d.s === "" || d.d === "" || !Number.isFinite(knots) || !Number.isFinite(fromDeg)) throw new Error(`NOAA wind: bad point at ${d.t}`);
    return { ts: d.t, knots, fromDeg };
  });
}
