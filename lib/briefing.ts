import { assessSafety } from "./safety";

export type Condition = { parameter: string; value: number; ts: string };

export function buildQuickBriefing(readings: Condition[]) {
  const values = Object.fromEntries(readings.map((reading) => [reading.parameter, reading.value]));
  // current_dir is the flow-toward heading: southward flow (90°–270°) is the ebb, else flood.
  const currentDirection = values.current_dir === undefined ? "ebb" : values.current_dir > 90 && values.current_dir < 270 ? "ebb" : "flood";
  const assessment = assessSafety({ dischargeCfs: values.discharge, currentKnots: values.current_speed, windKnots: values.wind_speed, windDirection: values.wind_dir, currentDirection });
  const stamp = readings.length ? new Date(Math.max(...readings.map((reading) => Date.parse(reading.ts)))).toLocaleString() : "No saved reading yet";
  const wind = values.wind_speed === undefined ? "wind not available" : `${values.wind_speed.toFixed(1)} kn wind`;
  const flow = values.discharge === undefined ? "flow not available" : `${Math.round(values.discharge).toLocaleString()} cfs flow`;
  const verdict = assessment.verdict === "safe" ? "🟢 GO" : assessment.verdict === "caution" ? "🟡 CAUTION" : "🔴 NO-GO";
  const reason = assessment.opposingWind ? "Wind is opposing the ebb, which can steepen chop." : `Overall risk is ${assessment.verdict}.`;
  return { assessment, updatedAt: stamp, summary: `${verdict} — latest river readings: ${wind}, ${flow}. ${reason}` };
}

export function buildFastAnswer(question: string, readings: Condition[]) {
  const briefing = buildQuickBriefing(readings);
  const values = Object.fromEntries(readings.map((reading) => [reading.parameter, reading.value]));
  const beginner = /beginner|new|first time|novice/i.test(question);
  const verdict = briefing.assessment.verdict === "safe" ? "🟢 GO" : briefing.assessment.verdict === "caution" ? "🟡 CAUTION" : "🔴 NO-GO";
  const move = briefing.assessment.verdict === "danger" ? "Stand down and choose a protected shoreline walk or another day." : beginner ? "Keep it short, stay close to shore, wear PFDs, and turn back at the first sign of building chop." : "Launch early, stay conservative, and re-check conditions before you push off.";
  return `${verdict} — the river has a friendly window right now.\n\nWHY IT MATTERS\n• ${values.wind_speed === undefined ? "Wind data is not available" : `Wind is ${values.wind_speed.toFixed(1)} kn`} and flow is ${values.discharge === undefined ? "not available" : `${Math.round(values.discharge).toLocaleString()} cfs`}.\n• Readings last updated ${briefing.updatedAt}.\n\nBEST MOVE\n• ${move}\n\nNEXT ACTION → ${briefing.assessment.verdict === "safe" ? "It's a GO — Hoboken Cove Community Boathouse runs free paddle days, and I can re-check conditions right before you launch." : "Ask me for the latest conditions right before you launch — the river can change fast."}`;
}
