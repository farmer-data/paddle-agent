import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { buildFastAnswer, buildQuickBriefing } from "@/lib/briefing";
import { latestConditions } from "@/lib/clickhouse";
import { fetchNwsHourlyWind, fetchCurrentPredictions, type CurrentPrediction } from "@/lib/sources";
import { buildHourlyOutlook, assessWindow, type HourlyRisk, type PaddleWindow } from "@/lib/windows";
import { resolveWindow } from "@/lib/when";
import type { Risk } from "@/lib/safety";

export const runtime = "nodejs";

const cardSchema = z.object({
  headline: z.string().describe("One vivid line painting the river right now, max 90 chars, no verdict word — the UI shows that"),
  stats: z.array(z.object({
    value: z.string().describe("The number with unit, e.g. '4.3 kt'"),
    label: z.string().describe("What it is, 1-2 words, e.g. 'wind now'"),
    feel: z.string().describe("What it feels like in the boat, max 7 words"),
  })).min(1).max(2),
  launch: z.object({
    time: z.string().describe("Clock time to launch, e.g. '6:00 AM'"),
    why: z.string().describe("Max 10 words; name when the wind turns"),
  }).nullable().describe("null when the verdict is NO-GO"),
  note: z.string().describe("One line of dry local wit earned from today's numbers, max 16 words"),
  action: z.object({
    label: z.string().describe("Max 6 words, imperative"),
    hccb: z.boolean().describe("true if the action is HCCB's free paddle days"),
  }),
});
export type ReplyCard = z.infer<typeof cardSchema>;

export async function POST(request: Request) {
  const { message } = await request.json() as { message?: string };
  if (!message?.trim()) return Response.json({ error: "A question is required." }, { status: 400 });
  try {
    const readings = await latestConditions();
    const briefing = buildQuickBriefing(readings);
    const values = Object.fromEntries(readings.map((reading) => [reading.parameter, reading.value]));

    const target = resolveWindow(message);
    let hourly: HourlyRisk[] = [];
    let window: PaddleWindow | null = null;
    let forecast: { label: string; isNow: boolean; verdict: Risk | null; opposingWind: boolean; best: PaddleWindow | null } | null = null;
    let beyondHorizon = false;
    try {
      const [wind, current] = await Promise.all([
        fetchNwsHourlyWind(),
        fetchCurrentPredictions(target.date).catch(() => [] as CurrentPrediction[]),
      ]);
      hourly = buildHourlyOutlook(wind, current, { dischargeCfs: values.discharge }, target);
      beyondHorizon = !target.isNow && wind.length > 0 && hourly.length === 0;
      const assessed = assessWindow(hourly);
      window = assessed.best;
      forecast = {
        label: target.label,
        isNow: target.isNow,
        verdict: beyondHorizon ? null : assessed.verdict,
        opposingWind: assessed.opposingWind,
        best: assessed.best,
      };
    } catch {
      // Forecast is best-effort; the reply still works from the snapshot alone.
    }

    const windowNote = beyondHorizon
      ? `${target.label} is beyond the ~7-day forecast horizon — say you cannot see that far out and do not give a go/no-go verdict.`
      : window
        ? `Best paddle window for ${target.label}: ${window.startLabel}–${window.endLabel} (${window.risk === "safe" ? "green" : "caution"}).`
        : `No clear multi-hour window for ${target.label}.`;
    const hourlyDigest = hourly.length
      ? `Hourly wind+current outlook for ${target.label}: ${hourly.map((h) => `${h.hourLabel} ${h.windKnots}kt/${h.risk}${h.opposing ? "/opposing" : ""}`).join(", ")}.`
      : "No hourly forecast available for that window.";
    const dischargeNote = `\nRiver discharge is assumed steady from the latest reading (${values.discharge === undefined ? "n/a" : `${Math.round(values.discharge)} cfs`}); it is not forecast.`;
    const hccbNote = (forecast?.verdict ?? briefing.assessment.verdict) === "safe"
      ? "\nThe verdict is GO, so the action should be Hoboken Cove Community Boathouse's free paddle days (hccb: true)."
      : "";

    try {
      const { object: card } = await generateObject({
        model: openai("gpt-5-mini"), maxOutputTokens: 1400,
        providerOptions: { openai: { reasoningEffort: "low" } },
        schema: cardSchema,
        system: "You are Paddle Agent — a Hudson River guide with sixteen years on this water: sharp, warm, a little salty, allergic to filler. You fill a visual briefing card; the UI does the talking, so every field is short and earns its place. Pair numbers with what they feel like in the boat. Use the hourly trend for the requested window to pick the launch time — name when the wind turns; when the question names a future day, speak to that day, not to right now. Never invent readings, never use weather-app phrasing.",
        prompt: `Paddler question: ${message}\nTarget window: ${target.label}\n\nLatest readings (${briefing.updatedAt}):\n${JSON.stringify(readings)}\nSafety assessment (now): ${JSON.stringify(briefing.assessment)}\nForecast verdict for ${target.label}: ${forecast?.verdict ?? "unknown"}\n${windowNote}\n${hourlyDigest}${dischargeNote}${hccbNote}`,
      });
      // gpt-5-mini occasionally leaks JSON syntax into string fields
      const clean = (value: string) => value.replace(/[{}[\]"\\]+/g, " ").replace(/\s+/g, " ").trim();
      const safeCard = {
        ...card,
        headline: clean(card.headline),
        stats: card.stats.map((stat) => ({ value: clean(stat.value), label: clean(stat.label), feel: clean(stat.feel) })),
        launch: card.launch ? { time: clean(card.launch.time), why: clean(card.launch.why) } : null,
        note: clean(card.note),
        action: { ...card.action, label: clean(card.action.label) },
      };
      return Response.json({ card: safeCard, text: null, readings, briefing, hourly, window, forecast });
    } catch {
      return Response.json({ card: null, text: buildFastAnswer(message, readings), readings, briefing, hourly, window, forecast });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Paddle Agent could not answer." }, { status: 503 });
  }
}
