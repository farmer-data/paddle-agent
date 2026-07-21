import { randomUUID } from "node:crypto";
import { createClient } from "@clickhouse/client";
import type { PaddleTripData } from "./chat-types";
import type { Reading } from "./sources";

// ClickHouse `trips.started_at` is DateTime('America/New_York'); format wall-clock NY time.
function nyDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

const client = process.env.CLICKHOUSE_URL ? createClient({ url: process.env.CLICKHOUSE_URL, username: process.env.CLICKHOUSE_USERNAME, password: process.env.CLICKHOUSE_PASSWORD, database: process.env.CLICKHOUSE_DATABASE ?? "default", request_timeout: 30_000 }) : undefined;
export function db() { if (!client) throw new Error("ClickHouse is not configured. Set CLICKHOUSE_URL, CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD."); return client; }
export async function insertReadings(readings: Reading[]) { if (readings.length) await db().insert({ table: "readings", values: readings.map((r) => ({ station_id: r.stationId, source: r.source, parameter: r.parameter, ts: r.ts, value: r.value })), format: "JSONEachRow" }); }
export async function query<T>(query: string, query_params?: Record<string, string | number>) { const result = await db().query({ query, query_params, format: "JSONEachRow" }); return result.json<T>(); }
export async function latestConditions() { return query<{ parameter: string; value: number; ts: string }>("SELECT parameter, latest_value AS value, toString(latest_at) AS ts FROM (SELECT parameter, argMax(value, ts) AS latest_value, max(ts) AS latest_at FROM readings WHERE parameter IN ('discharge','current_speed','current_dir','wind_speed','wind_dir') GROUP BY parameter)"); }

export type RoughTripStats = { rough_trips: number; median_wind: number; avg_wind: number; median_current: number; avg_current: number };
export type RoughTripRow = { trip_id: string; route: string; started_at: string; wind: number; current: number };

// Per rough-rated trip, match the readings row nearest in time (argMinIf over a ±12h
// window) — the OLTP `trips` records joined to historical OLAP `readings`.
const ROUGH_TRIP_INNER = `
  SELECT
    t.trip_id AS trip_id,
    any(t.route) AS route,
    toString(any(t.started_at)) AS started_at,
    argMinIf(r.value, abs(dateDiff('second', r.ts, t.started_at)), r.parameter = 'wind_speed') AS wind,
    argMinIf(r.value, abs(dateDiff('second', r.ts, t.started_at)), r.parameter = 'current_speed') AS current
  FROM trips AS t
  CROSS JOIN readings AS r
  WHERE t.rating = 'rough'
    AND r.parameter IN ('wind_speed', 'current_speed')
    AND r.ts BETWEEN t.started_at - INTERVAL 12 HOUR AND t.started_at + INTERVAL 12 HOUR
  GROUP BY t.trip_id
  HAVING wind > 0`;

export async function roughTripComparison(): Promise<{ stats: RoughTripStats; trips: RoughTripRow[] }> {
  const stats = await query<RoughTripStats>(`
    SELECT
      count() AS rough_trips,
      round(quantile(0.5)(wind), 1) AS median_wind,
      round(avg(wind), 1) AS avg_wind,
      round(quantile(0.5)(current), 2) AS median_current,
      round(avg(current), 2) AS avg_current
    FROM (${ROUGH_TRIP_INNER})`);
  const trips = await query<RoughTripRow>(`
    SELECT trip_id, route, started_at, round(wind, 1) AS wind, round(current, 2) AS current
    FROM (${ROUGH_TRIP_INNER})
    ORDER BY started_at DESC
    LIMIT 8`);
  return { stats: stats[0] ?? { rough_trips: 0, median_wind: 0, avg_wind: 0, median_current: 0, avg_current: 0 }, trips };
}

export async function insertTrip(input: { route: string; rating: PaddleTripData["rating"]; notes?: string; startedAt?: string; userId?: string }): Promise<PaddleTripData> {
  const record: PaddleTripData = {
    tripId: randomUUID(),
    userId: input.userId ?? "local-paddler",
    route: input.route,
    rating: input.rating,
    notes: input.notes ?? "",
    startedAt: input.startedAt && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(input.startedAt) ? input.startedAt.replace("T", " ") : nyDateTime(),
  };
  await db().insert({
    table: "trips",
    values: [{ trip_id: record.tripId, user_id: record.userId, started_at: record.startedAt, route: record.route, rating: record.rating, notes: record.notes }],
    format: "JSONEachRow",
  });
  return record;
}
