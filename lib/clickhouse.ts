import { createClient } from "@clickhouse/client";
import type { Reading } from "./sources";

const client = process.env.CLICKHOUSE_URL ? createClient({ url: process.env.CLICKHOUSE_URL, username: process.env.CLICKHOUSE_USERNAME, password: process.env.CLICKHOUSE_PASSWORD, database: process.env.CLICKHOUSE_DATABASE ?? "default", request_timeout: 30_000 }) : undefined;
export function db() { if (!client) throw new Error("ClickHouse is not configured. Set CLICKHOUSE_URL, CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD."); return client; }
export async function insertReadings(readings: Reading[]) { if (readings.length) await db().insert({ table: "readings", values: readings.map((r) => ({ station_id: r.stationId, source: r.source, parameter: r.parameter, ts: r.ts, value: r.value })), format: "JSONEachRow" }); }
export async function query<T>(query: string, query_params?: Record<string, string | number>) { const result = await db().query({ query, query_params, format: "JSONEachRow" }); return result.json<T>(); }
export async function latestConditions() { return query<{ parameter: string; value: number; ts: string }>("SELECT parameter, latest_value AS value, toString(latest_at) AS ts FROM (SELECT parameter, argMax(value, ts) AS latest_value, max(ts) AS latest_at FROM readings WHERE parameter IN ('discharge','current_speed','current_dir','wind_speed','wind_dir') GROUP BY parameter)"); }
