import type { LonLat } from "./zones";
import { nyParts } from "./time";

const NOAA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

// ---- zone-aware fetchers: each throws on a non-OK response or malformed payload ----

export const DIRECTION_DEGREES: Record<string, number> = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };

export type CurrentPoint = { ts: string; signed: number; towardDeg: number };
// fromDeg is null when NWS gave no usable direction for a non-calm period: that hour's wind counts as missing.
export type WindPeriod = { ts: string; windKnots: number; fromDeg: number | null; direction: string };
export type Alert = { id?: string; event: string; endsAt: string | null };
export type AlertsResult = { alerts: Alert[]; updatedAt: string };
export type HourlyWind = { periods: WindPeriod[]; updatedAt: string; updateTime: string | null };

const HEADERS = { "User-Agent": "PaddleAgent/0.2" };

// "no-store" for sources whose age is checked and whose stale cached body would be served first (alerts, observations).
async function getJson(url: string | URL, revalidate: number | "no-store"): Promise<any> {
  const res = await fetch(url, revalidate === "no-store" ? { headers: HEADERS, cache: "no-store" } : { headers: HEADERS, next: { revalidate } });
  if (!res.ok) throw new Error(`${new URL(String(url)).host} responded ${res.status}`);
  return res.json();
}

const noaaUrl = (params: Record<string, string>) => {
  const url = new URL(NOAA);
  url.search = new URLSearchParams({ time_zone: "lst_ldt", units: "english", format: "json", application: "paddle-agent", ...params }).toString();
  return url;
};

export async function fetchHourlyWind(p: LonLat): Promise<HourlyWind> {
  const point = await getJson(`https://api.weather.gov/points/${p[1]},${p[0]}`, 86400);
  const hourlyUrl = point?.properties?.forecastHourly;
  if (typeof hourlyUrl !== "string") throw new Error("NWS points: no forecastHourly");
  const forecast = await getJson(hourlyUrl, 1800);
  const raw = forecast?.properties?.periods;
  if (!Array.isArray(raw)) throw new Error("NWS hourly: no periods");
  const periods = raw.map((x: any): WindPeriod => {
    const mph = Math.max(...(String(x.windSpeed).match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
    if (!Number.isFinite(mph)) throw new Error("NWS hourly: unreadable wind");
    // Calm (0 mph) with no direction: 0 kn cannot raise any band or oppose a current, so a placeholder bearing is safe.
    // Any other period without a readable direction gets null and counts as wind missing for that hour only.
    const known = DIRECTION_DEGREES[x.windDirection];
    const fromDeg = known !== undefined ? known : mph === 0 ? 0 : null;
    // Knots stay unrounded: 14 mph (12.17 kn) must still read as over a 12 kn threshold. Round for display only.
    return { ts: x.startTime, windKnots: mph * 0.868976, fromDeg, direction: typeof x.windDirection === "string" ? x.windDirection : "" };
  });
  const props = forecast.properties;
  return { periods, updatedAt: String(props.generatedAt ?? props.updateTime), updateTime: typeof props.updateTime === "string" ? props.updateTime : null };
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
  const json = await getJson(url, "no-store");
  const values = json?.value?.timeSeries?.[0]?.values?.[0]?.value;
  const last = Array.isArray(values) ? values[values.length - 1] : undefined;
  const cfs = Number(last?.value);
  if (!last || last.value === "" || !Number.isFinite(cfs) || cfs < 0) throw new Error("USGS discharge: no data");
  return { cfs, at: last.dateTime };
}

export async function fetchWaterTemp(): Promise<{ f: number; at: string }> {
  const json = await getJson(noaaUrl({ product: "water_temperature", station: "8518750", date: "latest" }), "no-store");
  const item = json?.data?.[0];
  const f = Number(item?.v);
  if (!item || item.v === "" || !Number.isFinite(f)) throw new Error("NOAA water temperature: no data");
  return { f, at: item.t };
}

async function getAlerts(url: string): Promise<AlertsResult> {
  const json = await getJson(url, "no-store");
  if (!Array.isArray(json?.features)) throw new Error("NWS alerts: malformed payload");
  const updated = json.updated;
  return {
    // The collection's own timestamp is what freshness is judged on; fall back to the fetch time if NWS omits it.
    updatedAt: typeof updated === "string" && updated !== "" ? updated : new Date().toISOString(),
    // `ends` is when the event ends; `expires` is only when the message lapses, so it is deliberately not used.
    alerts: json.features.map((f: any): Alert => ({ id: f.id ?? f.properties?.id, event: f.properties.event, endsAt: f.properties.ends ?? null })),
  };
}

// Land-based alerts (thunderstorms and the like) for the point. The zone centres lie outside every marine polygon.
export const fetchAlerts = (p: LonLat) => getAlerts(`https://api.weather.gov/alerts/active?point=${p[1]},${p[0]}`);

// Marine alerts (Small Craft Advisory, Gale Warning…) for an NWS marine zone such as ANZ338.
export const fetchMarineAlerts = (nwsZone: string) => getAlerts(`https://api.weather.gov/alerts/active?zone=${encodeURIComponent(nwsZone)}`);

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
