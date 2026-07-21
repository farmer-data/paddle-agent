import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { buildFastAnswer, buildQuickBriefing } from "@/lib/briefing";
import { latestConditions } from "@/lib/clickhouse";
import { fetchNwsHourlyWind, fetchCurrentPredictions, type CurrentPrediction } from "@/lib/sources";
import { buildHourlyOutlook, assessWindow, summarizeCurrent, hourKey, type HourlyRisk, type PaddleWindow, type CurrentSummary } from "@/lib/windows";
import { resolveWindow } from "@/lib/when";
import type { Risk } from "@/lib/safety";

export const runtime = "nodejs";

const cardSchema = z.object({
  headline: z.string().describe("One vivid line painting the river right now, max 90 chars, no verdict word — the UI shows that"),
  stats: z.array(z.object({
    value: z.string().describe("The number with unit, e.g. '4.3 kt'"),
    label: z.string().describe("What it is, 1-2 words, e.g. 'wind now'"),
    feel: z.string().describe("What it feels like in the boat — vivid, salty, max 9 words. For the current, name what the tide is doing (ebb/flood/slack, wind-vs-tide chop)."),
  })).min(1).max(2),
  launch: z.object({
    time: z.string().describe("Clock time to launch, e.g. '6:00 AM'"),
    why: z.string().describe("Max 10 words; name when the wind turns"),
  }).nullable().describe("null when the verdict is NO-GO"),
  note: z.string().describe("One line of dry local wit earned from today's numbers, max 16 words"),
  currentLine: z.string().describe("one salty line about the tidal current for this window, max 12 words"),
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
    let currentPreds: CurrentPrediction[] = [];
    let window: PaddleWindow | null = null;
    let forecast: { label: string; isNow: boolean; verdict: Risk | null; opposingWind: boolean; best: PaddleWindow | null } | null = null;
    let beyondHorizon = false;
    try {
      const [wind, cp] = await Promise.all([
        fetchNwsHourlyWind(),
        fetchCurrentPredictions(target.date).catch(() => [] as CurrentPrediction[]),
      ]);
      currentPreds = cp;
      hourly = buildHourlyOutlook(wind, cp, { dischargeCfs: values.discharge }, target);
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
    const currentNote = (() => {
      const kt = values.current_speed;
      if (kt === undefined) return "\nTidal current: not available right now.";
      const dir = values.current_dir;
      const flooding = dir !== undefined && !(dir > 90 && dir < 270);
      if (kt < 0.2) return `\nTidal current now: ${kt.toFixed(2)} kt — basically slack, the river hanging between tides.`;
      const bearing = flooding
        ? "flooding, flowing north as the sea shoulders back upriver (a paddle you pay for going out)"
        : "ebbing, sliding south and seaward toward the harbor (a free ride out, earned back on return)";
      const clash = briefing.assessment.opposingWind
        ? " Wind is set against the tide, so the chop stacks up short and steep."
        : "";
      return `\nTidal current now: ${kt.toFixed(2)} kt, ${bearing}.${clash}`;
    })();
    const hccbNote = (forecast?.verdict ?? briefing.assessment.verdict) === "safe"
      ? "\nThe verdict is GO, so the action should be Hoboken Cove Community Boathouse's free paddle days (hccb: true)."
      : "";
    const currentDirNow = values.current_dir === undefined ? undefined : (values.current_dir > 90 && values.current_dir < 270 ? "ebb" : "flood");
    const nowSigned = values.current_speed === undefined || !target.isNow
      ? null
      : (currentDirNow === "flood" ? values.current_speed : -values.current_speed);
    const currentSummary: CurrentSummary = hourly.length
      ? summarizeCurrent(currentPreds, hourKey(hourly[0].ts), hourKey(hourly[hourly.length - 1].ts))
      : { nextTurn: null, peakEbb: null, peakFlood: null };
    const hasCurve = hourly.some((h) => h.current !== null);
    const firstSigned = hourly.find((h) => h.current !== null)?.current ?? null;
    const fallbackCaption = firstSigned === null ? "" : firstSigned < 0 ? "ebb — free ride out, you pay coming back" : "flood — you earn every stroke out";

    try {
      const { object: card } = await generateObject({
        model: openai("gpt-5-mini"), maxOutputTokens: 1400,
        providerOptions: { openai: { reasoningEffort: "low" } },
        schema: cardSchema,
        system: "You are Paddle Agent — a Hudson River guide with sixteen years on this water: sharp, warm, a little salty, allergic to filler. You fill a visual briefing card; the UI does the talking, so every field is short and earns its place. Pair numbers with what they feel like in the boat. Give the tide real character in the 'current now' stat: the ebb is a free ride seaward, the flood makes you pay to go out, slack is the river holding its breath, and wind set against the tide stacks the chop short and steep — read the current like a guide who knows the water, never a weather app. Use the hourly trend for the requested window to pick the launch time — name when the wind turns; when the question names a future day, speak to that day, not to right now. Never invent readings, never use weather-app phrasing.",
        prompt: `Paddler question: ${message}\nTarget window: ${target.label}\n\nLatest readings (${briefing.updatedAt}):\n${JSON.stringify(readings)}\nSafety assessment (now): ${JSON.stringify(briefing.assessment)}\nForecast verdict for ${target.label}: ${forecast?.verdict ?? "unknown"}\n${windowNote}\n${hourlyDigest}${dischargeNote}${currentNote}${hccbNote}`,
      });
      // gpt-5-mini occasionally leaks JSON syntax into string fields
      const clean = (value: string) => value.replace(/[{}[\]"\\]+/g, " ").replace(/\s+/g, " ").replace(/[\s,;]+$/, "").trim();
      const safeCard = {
        ...card,
        headline: clean(card.headline),
        stats: card.stats.map((stat) => ({ value: clean(stat.value), label: clean(stat.label), feel: clean(stat.feel) })),
        launch: card.launch ? { time: clean(card.launch.time), why: clean(card.launch.why) } : null,
        note: clean(card.note),
        action: { ...card.action, label: clean(card.action.label) },
      };
      const current = hasCurve ? { nowSigned, summary: currentSummary, caption: clean(card.currentLine) } : null;
      return Response.json({ card: safeCard, text: null, readings, briefing, hourly, window, forecast, current });
    } catch {
      const current = hasCurve ? { nowSigned, summary: currentSummary, caption: fallbackCaption } : null;
      return Response.json({ card: null, text: buildFastAnswer(message, readings), readings, briefing, hourly, window, forecast, current });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Paddle Agent could not answer." }, { status: 503 });
  }
}
