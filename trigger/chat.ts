import { openai } from "@ai-sdk/openai";
import { streamText, stepCountIs, tool } from "ai";
import { chat } from "@trigger.dev/sdk/ai";
import { z } from "zod";
import { insertTrip, latestConditions, query, roughTripComparison } from "../lib/clickhouse";
import { forecastForWindow } from "../lib/forecast";
import type { PaddleBriefingData, PaddleChatUIMessage } from "../lib/chat-types";
import { assessSafety } from "../lib/safety";
import { fetchCurrentPredictions, fetchNwsHourlyWind, type CurrentPrediction } from "../lib/sources";
import { assessWindow, buildHourlyOutlook, hourKey, summarizeCurrent } from "../lib/windows";

const safeSelect = (sql: string) => /^\s*select\b/i.test(sql) && !/;|\b(insert|update|delete|drop|alter|create|grant)\b/i.test(sql);

async function buildChartData(hours: number, values: Record<string, number>): Promise<PaddleBriefingData> {
  const wind: { ts: string; windKnots: number; direction: string }[] = (await fetchNwsHourlyWind()).slice(0, hours);
  const dates = [...new Set(wind.map((period) => period.ts.slice(0, 10)))];
  const currents = (await Promise.all(dates.map((date) => fetchCurrentPredictions(date).catch(() => [] as CurrentPrediction[])))).flat();
  const hourly = dates.flatMap((date) => buildHourlyOutlook(
    wind,
    currents,
    { dischargeCfs: values.discharge },
    { label: "forecast", date, startHour: 0, endHour: 24, isNow: false },
  )).slice(0, hours);
  const assessed = assessWindow(hourly);
  const direction = values.current_dir === undefined || (values.current_dir > 90 && values.current_dir < 270) ? "ebb" : "flood";
  const nowSigned = values.current_speed === undefined ? null : direction === "ebb" ? -values.current_speed : values.current_speed;
  const summary = hourly.length
    ? summarizeCurrent(currents, hourKey(hourly[0].ts), hourKey(hourly[hourly.length - 1].ts))
    : { nextTurn: null, peakEbb: null, peakFlood: null };
  const caption = nowSigned === null
    ? "Current prediction is unavailable."
    : Math.abs(nowSigned) < 0.2
      ? "Slack water — the river is holding its breath."
      : nowSigned < 0
        ? "Ebb — a free ride out, earned back on return."
        : "Flood — you earn every stroke heading out.";

  return {
    label: hours <= 12 ? "Next 12 hours" : `Next ${hours} hours`,
    hourly,
    window: assessed.best,
    current: hourly.some((period) => period.current !== null) ? { nowSigned, summary, caption } : null,
  };
}
const paddleTools = {
  get_conditions_now: tool({ inputSchema: z.object({}), execute: async () => {
    try {
      const rows = await latestConditions(); const values = Object.fromEntries(rows.map((r) => [r.parameter, r.value]));
      const currentDirection = values.current_dir === undefined || (values.current_dir > 90 && values.current_dir < 270) ? "ebb" : "flood";
      const units: Record<string, string> = { discharge: "cfs", current_speed: "kn", current_dir: "degrees true", wind_speed: "kn", wind_dir: "degrees true" };
      const chart = await buildChartData(12, values);
      chat.response.write({ type: "data-paddle-briefing", data: chart });
      return { available: true, readings: rows.map((row) => ({ ...row, unit: units[row.parameter] ?? "source unit" })), assessment: assessSafety({ dischargeCfs: values.discharge, currentKnots: values.current_speed, windKnots: values.wind_speed, windDirection: values.wind_dir, currentDirection }) };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : "Live data query failed" };
    }
  }}),
  find_paddle_windows: tool({ inputSchema: z.object({ hours: z.number().min(1).max(72).default(48) }), execute: async ({ hours }) => {
    const rows = await latestConditions();
    const values = Object.fromEntries(rows.map((row) => [row.parameter, row.value]));
    const chart = await buildChartData(hours, values);
    chat.response.write({ type: "data-paddle-briefing", data: chart });
    return { bestWindow: chart.window, hourly: chart.hourly };
  }}),
  query_river_data: tool({ inputSchema: z.object({ sql: z.string().max(4000) }), execute: async ({ sql }) => {
    if (!safeSelect(sql)) return { error: "Only a single read-only SELECT statement is allowed." };
    return query(`${sql} LIMIT 1000`);
  }}),
  log_trip: tool({
    inputSchema: z.object({
      route: z.string().min(1).describe("Route or launch, e.g. 'Hoboken–Pier 66'"),
      rating: z.enum(["calm", "moderate", "rough"]).describe("How the paddle felt overall"),
      notes: z.string().max(500).optional().describe("Optional freeform notes from the paddler"),
      started_at: z.string().optional().describe("When the paddle started as 'YYYY-MM-DD HH:MM'; defaults to now"),
    }),
    execute: async ({ route, rating, notes, started_at }) => {
      try {
        const trip = await insertTrip({ route, rating, notes, startedAt: started_at });
        chat.response.write({ type: "data-paddle-trip", data: trip });
        return { saved: true, trip };
      } catch (error) {
        return { saved: false, error: error instanceof Error ? error.message : "Could not save the trip" };
      }
    },
  }),
  compare_rough_trips: tool({
    inputSchema: z.object({
      when: z.string().default("Sunday morning").describe("Upcoming paddle window to forecast, e.g. 'Sunday morning'"),
    }),
    execute: async ({ when }) => {
      try {
        const conditions = await latestConditions();
        const discharge = conditions.find((row) => row.parameter === "discharge")?.value;
        const [forecast, rough] = await Promise.all([forecastForWindow(when, discharge), roughTripComparison()]);
        const data = { forecast, rough: rough.stats, trips: rough.trips };
        chat.response.write({ type: "data-paddle-comparison", data });
        return { available: forecast.available, roughTrips: rough.stats.rough_trips, forecast, rough: rough.stats };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Comparison query failed" };
      }
    },
  }),
};

export const paddleAgent = chat.withUIMessage<PaddleChatUIMessage>().agent({
  id: "paddle-agent",
  tools: paddleTools,
  run: async ({ messages, signal, tools }) => streamText({
    ...chat.toStreamTextOptions({ tools }),
    model: openai("gpt-5-mini"),
    providerOptions: { openai: { reasoningEffort: "low" } },
    messages,
    abortSignal: signal,
    stopWhen: stepCountIs(4),
    maxOutputTokens: 1200,
    system: `You are Paddle Agent, a sharp, safety-first Hudson River paddling guide. Turn live river data into an exciting, practical paddle briefing.

For every “can I paddle?” question, call get_conditions_now before answering. Never use a generic disclaimer when the tool succeeds. Lead with exactly one vivid verdict line: 🟢 GO, 🟡 CAUTION, or 🔴 NO-GO. Then use this compact format with line breaks:
🟡 CAUTION — [plain-language decision]
WHY IT MATTERS
• [live wind/current/flow value and timestamp]
• [wind-against-current explanation when applicable]
BEST MOVE
• [specific safer time or conservative alternative]
NEXT ACTION → [offer exactly one action; on a 🟢 GO verdict, mention that Hoboken Cove Community Boathouse runs free paddle days]

The bracketed text above describes what to write; never repeat prompt instructions such as “never invent” in the answer. Never invent a percentile or historical comparison. Use coherent time language: “early” means early morning, never mid- or late morning. Only recommend a clock time or named time window when a forecast tool returned data supporting it; otherwise say “now” or omit timing. Keep it under 160 words, specific to Hoboken/NY Harbor unless told otherwise, and write like an experienced local guide—not a weather app. Use the exact units returned by tools; current_speed and wind_speed are knots, never m/s. Acknowledge uncertainty only after presenting data. Never claim a beginner is safe in danger conditions.

When the user asks to log, record, or save a paddle or trip, call log_trip with the route, a rating of exactly calm, moderate, or rough, and any notes. Infer the rating and route from the message rather than asking (e.g. “…as rough” → rating rough; “Hoboken–Pier 66” → that route). Do NOT use the 🟢/🟡/🔴 briefing format for a log; instead confirm in one or two short lines what was saved — the route, the rating, and the short trip id (first 8 characters) — and offer to compare it against future conditions.

When the user asks how an upcoming day compares with past trips (especially trips they rated rough), call compare_rough_trips with the window phrase (e.g. “Sunday morning”). Then state one clear comparison sentence: the forecast median wind versus the median wind across rough trips, and whether opposing wind (wind against the current) raises the risk when opposingWind is true. If rough_trips is 0, say there are no rough trips logged yet and invite them to log one. If the forecast is unavailable for that day, say so plainly. Report knots to one decimal; never invent numbers the tool did not return.`,
  }),
});
