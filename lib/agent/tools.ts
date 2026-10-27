import { tool } from "ai";
import { z } from "zod";
import { roughTripStats, windowForecast } from "../compare";
import type { Mode } from "../config";
import { CONFIG } from "../config";
import { bestWindow, bestWindowText, buildZoneOutlook, type OutlookInputs, type ZoneOutlook } from "../outlook";
import { findPlace } from "../route/graph";
import { planRoute, summarizeRoute } from "../route/plan";
import { nyParts, nyStamp, nyWallToDate } from "../time";
import { tripSnapshot } from "../trip-snapshot";
import type { RequestTrip, Trip } from "../trips";
import { resolveWindow } from "../when";
import { PLACES, ZONES, zoneById, type ZoneId } from "../zones";
import type { PaddleBriefingData, PaddleDataPart } from "./types";

export type PaddleToolContext = {
  write: (part: PaddleDataPart) => void;
  zoneId: ZoneId;
  mode: Mode;
  trips: RequestTrip[];
  inputs: OutlookInputs;
  now: Date;
  loadInputs: (dates: string[]) => Promise<OutlookInputs>;
};

const zoneIds = ZONES.map((z) => z.id) as [ZoneId, ...ZoneId[]];
const zoneField = z.enum(zoneIds).optional().describe("Zone id; defaults to the paddler's selected zone");
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

const hourRow = (h: PaddleBriefingData["hours"][number]) => ({
  at: h.key, wind_kn: h.windKnots, wind_from: h.direction, current_kn: h.current === null ? null : Number(h.current.toFixed(2)),
  phase: h.current === null ? null : h.current < 0 ? "ebb" : "flood", risk: h.risk, opposing: h.opposing, daylight: h.daylight, reasons: h.reasons,
});

export function createPaddleTools(ctx: PaddleToolContext) {
  const outlookFor = (zoneId: ZoneId, inputs: OutlookInputs = ctx.inputs, from?: Date) => buildZoneOutlook(inputs, zoneId, ctx.mode, ctx.now, from);

  const briefing = (o: ZoneOutlook, hours: ZoneOutlook["hours"], label: string, bestText: PaddleBriefingData["bestText"], best: PaddleBriefingData["best"]) => {
    const data: PaddleBriefingData = {
      zoneId: o.zoneId, zoneName: o.zoneName, mode: o.mode, label, hours, best, bestText,
      currentNow: o.currentNow, gear: o.gear, rainBadge: o.rainBadge, alerts: o.alerts, unavailable: o.unavailable,
    };
    ctx.write({ type: "data-paddle-briefing", data });
    return {
      zone: o.zoneName, mode: o.mode, label, bestText, gear: o.gear, rainBadge: o.rainBadge, alerts: o.alerts,
      unavailable: o.unavailable, current_now: o.currentNow, updatedAt: o.updatedAt, hours: hours.map(hourRow),
    };
  };

  return {
    get_conditions: tool({
      description: "Current and next-few-hours paddling conditions (wind, current, alerts, verdict) for a zone. Call this for any 'can I paddle?' question.",
      inputSchema: z.object({ zone: zoneField }),
      execute: async ({ zone }) => {
        const o = outlookFor(zone ?? ctx.zoneId);
        return briefing(o, o.strip.hours, o.strip.label, bestWindowText(o.best, o.strip.label), o.best);
      },
    }),

    find_paddle_windows: tool({
      description: "Find the best paddling windows over the next N hours (default 48).",
      inputSchema: z.object({ zone: zoneField, hours: z.number().int().min(1).max(CONFIG.outlookHours).optional().describe("Hours to look ahead; default 48") }),
      execute: async ({ zone, hours }) => {
        const n = hours ?? 48;
        const o = outlookFor(zone ?? ctx.zoneId);
        const slice = o.hours.slice(0, n);
        const best = bestWindow(slice);
        const day = best.kind !== "none" && best.startKey.slice(0, 10) !== nyParts(ctx.now).date ? "Tomorrow" : "Today";
        const text = bestWindowText(best, day);
        // "No 🟢 window today" would misdescribe a multi-day search.
        const bestText = best.kind === "green" ? text : { ...text, primary: `No 🟢 window in the next ${n} hours` };
        return briefing(o, slice, `Next ${n} hours`, bestText, best);
      },
    }),

    plan_route: tool({
      description: "Plan a paddle between two named places: distance, duration, hazards and the best departure. Use place names such as 'Pier 40'.",
      inputSchema: z.object({
        from: z.string().min(1).max(200).describe("Start place name"),
        to: z.string().min(1).max(200).describe("Destination place name"),
        depart: z.string().max(40).optional().describe("Departure as 'YYYY-MM-DD HH:MM' New York time; defaults to the next whole hour"),
        outAndBack: z.boolean().optional().describe("Return to the start"),
        turnaround: z.string().max(40).optional().describe("Turnaround time 'YYYY-MM-DD HH:MM' for out-and-back trips"),
      }),
      execute: async ({ from, to, depart, outAndBack, turnaround }) => {
        const a = findPlace(from), b = findPlace(to);
        if (!a || !b) {
          return { error: `I don't know ${!a ? `"${from}"` : `"${to}"`}. Use one of the known places.`, knownPlaces: PLACES.map((p) => p.name) };
        }
        const p = nyParts(ctx.now);
        const departAt = depart && STAMP.test(depart) ? depart : nyStamp(new Date(nyWallToDate(p.date, p.hour).getTime() + 3_600_000));
        const outlooks = Object.fromEntries(ZONES.map((zn) => [zn.id, outlookFor(zn.id)])) as Record<ZoneId, ZoneOutlook>;
        try {
          const plan = planRoute({ fromId: a.id, toId: b.id, depart: departAt, outAndBack, turnaround: turnaround && STAMP.test(turnaround) ? turnaround : undefined }, outlooks, ctx.mode, ctx.now);
          ctx.write({ type: "data-paddle-route", data: plan });
          return summarizeRoute(plan);
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Could not plan that route" };
        }
      },
    }),

    log_trip: tool({
      description: "Log a completed or just-finished paddle. The trip is handed to the paddler's browser to keep; the server stores nothing.",
      inputSchema: z.object({
        route: z.string().min(1).max(300).describe("Route or launch, e.g. 'Pier 40 to Pier 26'"),
        rating: z.enum(["calm", "moderate", "rough"]).describe("How the paddle felt overall"),
        notes: z.string().max(500).optional().describe("Optional freeform notes from the paddler"),
        started_at: z.string().regex(STAMP).optional().describe("When the paddle started as 'YYYY-MM-DD HH:MM' New York time; defaults to now"),
        zone: zoneField,
      }),
      execute: async ({ route, rating, notes, started_at, zone }) => {
        const place = findPlace(route);
        const zoneId = zone ?? place?.zoneId ?? ctx.zoneId;
        const startedAt = started_at ?? nyStamp(ctx.now);
        const snapshot = await tripSnapshot(zoneId, startedAt, ctx.mode, ctx.now, ctx.inputs);
        const trip: Trip = {
          tripId: crypto.randomUUID(), route, zoneId, placeId: place?.id ?? null, rating, notes: notes ?? "",
          startedAt, mode: ctx.mode, snapshot,
        };
        ctx.write({ type: "data-paddle-trip", data: trip });
        return { logged: true, keptIn: "the paddler's browser", shortId: trip.tripId.slice(0, 8), route, zone: zoneById(zoneId).name, rating, startedAt, snapshot };
      },
    }),

    compare_rough_trips: tool({
      description: "Compare an upcoming window's forecast with the paddler's rough trips (only the trips sent with this request).",
      inputSchema: z.object({ when: z.string().max(100).optional().describe("Upcoming window, e.g. 'Sunday morning'; default 'Sunday morning'"), zone: zoneField }),
      execute: async ({ when, zone }) => {
        const zoneId = zone ?? ctx.zoneId;
        const target = resolveWindow(when ?? "Sunday morning", ctx.now);
        let inputs = ctx.inputs;
        if (!target.isNow && !inputs.zones.some((zi) => zi.current?.some((c) => c.ts.startsWith(target.date)))) {
          try { inputs = await ctx.loadInputs([target.date]); } catch { /* fall through with what we have */ }
        }
        const outlook = outlookFor(zoneId, inputs, target.isNow ? undefined : nyWallToDate(target.date, target.startHour));
        const forecast = windowForecast(outlook, target);
        const rough = roughTripStats(ctx.trips);
        ctx.write({ type: "data-paddle-comparison", data: { forecast, rough: rough.stats, trips: rough.trips } });
        return { available: forecast.available, roughTrips: rough.stats.rough_trips, forecast, rough: rough.stats };
      },
    }),
  };
}
