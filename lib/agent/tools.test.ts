import { describe, expect, it, vi } from "vitest";
import { findPlace } from "../route/graph";
import { inputs, NOW } from "../test-fixtures";
import type { Trip } from "../trips";
import type { PaddleDataPart } from "./types";
import { createPaddleTools } from "./tools";

const loadInputs = vi.fn(async () => inputs());
const ctx = { write: (_p: PaddleDataPart) => {}, zoneId: "lower-hudson" as const, mode: "beginner" as const, trips: [] as Trip[], inputs: inputs(), now: NOW, loadInputs };
const opts = { toolCallId: "t", messages: [] };

const roughTrip = (wind: number, n: number): Trip => ({
  tripId: `r${wind}`, route: "r", zoneId: "lower-hudson", placeId: null, rating: "rough", notes: "", startedAt: `2026-10-${10 + n} 10:00`, mode: "beginner",
  snapshot: { windKnots: wind, windFromDeg: 180, currentKnots: 1, currentPhase: "ebb", verdict: "danger" },
});

describe("paddle tools", () => {
  it("get_conditions writes a briefing for the selected zone and mode", async () => {
    const parts: any[] = []; const tools = createPaddleTools({ ...ctx, write: (p) => parts.push(p) });
    const out = await tools.get_conditions.execute!({}, opts);
    expect(parts[0]).toMatchObject({ type: "data-paddle-briefing", data: { zoneId: "lower-hudson", mode: "beginner", label: "Today" } });
    expect(out).toHaveProperty("bestText");
  });
  it("get_conditions honours an explicit zone", async () => {
    const parts: any[] = [];
    await createPaddleTools({ ...ctx, write: (p) => parts.push(p) }).get_conditions.execute!({ zone: "lower-east" }, opts);
    expect(parts[0].data.zoneId).toBe("lower-east");
  });
  it("find_paddle_windows covers the first N hours", async () => {
    const parts: any[] = [];
    await createPaddleTools({ ...ctx, write: (p) => parts.push(p) }).find_paddle_windows.execute!({ hours: 24 }, opts);
    expect(parts[0].data.label).toBe("Next 24 hours");
    expect(parts[0].data.hours).toHaveLength(24);
    const def: any[] = [];
    await createPaddleTools({ ...ctx, write: (p) => def.push(p) }).find_paddle_windows.execute!({}, opts);
    expect(def[0].data.hours).toHaveLength(48);
  });
  it("plan_route returns known places for an unknown destination", async () => {
    const parts: any[] = [];
    const out: any = await createPaddleTools({ ...ctx, write: (p) => parts.push(p) }).plan_route.execute!({ from: "pier 40", to: "narnia" }, opts);
    expect(out.error).toBeTruthy(); expect(out.knownPlaces).toContain(findPlace("pier 40")!.name);
    expect(parts).toHaveLength(0);
  });
  it("plan_route turns planner errors into tool errors instead of throwing", async () => {
    const out: any = await createPaddleTools(ctx).plan_route.execute!({ from: "pier 40", to: "pier 40" }, opts);
    expect(out.error).toMatch(/same place/i);
    expect(out.knownPlaces).toBeUndefined();
  });
  it("plan_route writes the route and returns a summary", async () => {
    const parts: any[] = [];
    const out = await createPaddleTools({ ...ctx, write: (p) => parts.push(p) }).plan_route.execute!({ from: "pier 40", to: "pier 26" }, opts);
    expect(parts[0]).toMatchObject({ type: "data-paddle-route", data: { fromName: "Pier 40", toName: "Pier 26 (Tribeca)" } });
    expect(parts[0].data.request.depart).toBe("2026-10-26 13:00");
    expect(out).toContain("Planning estimate");
  });
  it("log_trip writes the trip for the browser to keep and infers the zone from the route", async () => {
    const parts: any[] = []; await createPaddleTools({ ...ctx, zoneId: "lower-east", write: (p) => parts.push(p) })
      .log_trip.execute!({ route: "Pier 40", rating: "rough" }, opts);
    expect(parts[0]).toMatchObject({ type: "data-paddle-trip", data: { rating: "rough", zoneId: findPlace("pier 40")!.zoneId, placeId: "pier-40" } });
  });
  it("log_trip falls back to the selected zone for an unknown route", async () => {
    const parts: any[] = []; await createPaddleTools({ ...ctx, zoneId: "lower-east", write: (p) => parts.push(p) })
      .log_trip.execute!({ route: "somewhere", rating: "calm" }, opts);
    expect(parts[0].data).toMatchObject({ zoneId: "lower-east", placeId: null });
  });
  it("compare_rough_trips uses only the trips sent with the request", async () => {
    const parts: any[] = [];
    await createPaddleTools({ ...ctx, trips: [roughTrip(10, 1), roughTrip(14, 2)], write: (p) => parts.push(p) })
      .compare_rough_trips.execute!({ when: "tomorrow morning" }, opts);
    expect(parts[0]).toMatchObject({ type: "data-paddle-comparison", data: { rough: { rough_trips: 2, median_wind: 12 } } });
    expect(loadInputs).not.toHaveBeenCalled();
  });
  it("compare_rough_trips loads inputs when the target date is outside the loaded data", async () => {
    const load = vi.fn(async () => inputs({ from: "2026-10-30" }));
    const parts: any[] = [];
    await createPaddleTools({ ...ctx, loadInputs: load, write: (p) => parts.push(p) }).compare_rough_trips.execute!({ when: "Friday morning" }, opts);
    expect(load).toHaveBeenCalledWith(["2026-10-30"]);
    expect(parts[0].data.forecast).toMatchObject({ available: true, date: "2026-10-30" });
  });
});
