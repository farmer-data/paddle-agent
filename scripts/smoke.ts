// Posts four real questions to a running dev server and checks the model called the right tool.
import type { PaddleDataPart } from "../lib/agent/types";
import type { Trip } from "../lib/trips";

const BASE = process.env.SMOKE_URL ?? "http://localhost:3000";

type Chunk = { type: string; delta?: string; data?: unknown; errorText?: string };

async function ask(text: string, trips: Trip[] = []): Promise<{ answer: string; parts: PaddleDataPart[] }> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] }],
      zoneId: "lower-hudson",
      mode: "beginner",
      trips,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  let answer = "";
  const parts: PaddleDataPart[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    const chunk = JSON.parse(payload) as Chunk;
    if (chunk.type === "text-delta") answer += chunk.delta ?? "";
    else if (chunk.type === "error") throw new Error(chunk.errorText ?? "stream error");
    else if (chunk.type.startsWith("data-paddle-")) parts.push(chunk as unknown as PaddleDataPart);
  }
  return { answer: answer.trim(), parts };
}

const roughTrip = (n: number): Trip => ({
  tripId: `smoke-${n}`, route: "Pier 40 to Pier 66", zoneId: "lower-hudson", placeId: null, rating: "rough",
  notes: "", startedAt: `2026-10-0${n}T09:00`, mode: "beginner",
  snapshot: { windKnots: 14 + n, windFromDeg: 300, currentKnots: 1.5, currentPhase: "ebb", verdict: "caution" },
});

type Case = { name: string; question: string; trips?: Trip[]; check: (parts: PaddleDataPart[]) => string | null };
const find = <T extends PaddleDataPart["type"]>(parts: PaddleDataPart[], type: T) =>
  parts.find((p): p is Extract<PaddleDataPart, { type: T }> => p.type === type);

const cases: Case[] = [
  {
    name: "briefing", question: "Can I paddle now?",
    check: (parts) => { const p = find(parts, "data-paddle-briefing"); return p ? `${p.data.label}: ${p.data.bestText.primary}` : null; },
  },
  {
    name: "trip", question: "Log today's Pier 40 paddle as rough.",
    check: (parts) => { const p = find(parts, "data-paddle-trip"); return p?.data.rating === "rough" ? `logged "${p.data.route}" as rough` : null; },
  },
  {
    name: "comparison", question: "How does Sunday morning compare with my rough trips?", trips: [roughTrip(1), roughTrip(2)],
    check: (parts) => { const p = find(parts, "data-paddle-comparison"); return p?.data.rough.rough_trips === 2 ? `forecast ${p.data.forecast.label} vs 2 rough trips` : null; },
  },
  {
    name: "route", question: "Plan Pier 40 to the Intrepid at 3pm",
    check: (parts) => { const p = find(parts, "data-paddle-route"); return p ? `${p.data.fromName} to ${p.data.toName}, ${p.data.distanceNm.toFixed(1)} nm, ${p.data.durationMin} min` : null; },
  },
];

async function main() {
  let failed = false;
  for (const c of cases) {
    try {
      const { answer, parts } = await ask(c.question, c.trips);
      const summary = c.check(parts);
      if (summary) console.log(`PASS ${c.name}: ${summary}`);
      else { failed = true; console.log(`FAIL ${c.name}: expected tool output missing. Parts: ${parts.map((p) => p.type).join(", ") || "none"}. Reply: ${answer.slice(0, 160)}`); }
    } catch (e) {
      failed = true;
      console.log(`FAIL ${c.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (failed) process.exit(1);
}

void main();
