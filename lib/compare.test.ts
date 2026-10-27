import { describe, expect, it } from "vitest";
import { roughTripStats, windowForecast } from "./compare";
import { buildZoneOutlook } from "./outlook";
import { inputs, NOW } from "./test-fixtures";
import { resolveWindow } from "./when";
import { nyWallToDate } from "./time";
import type { Trip } from "./trips";

const rough = (wind: number, cur: number, n = 0): Trip => ({
  tripId: `r${wind}`, route: "r", zoneId: "lower-hudson", placeId: null, rating: "rough", notes: "", startedAt: `2026-10-${10 + n} 10:00`, mode: "beginner",
  snapshot: { windKnots: wind, windFromDeg: 180, currentKnots: cur, currentPhase: "ebb", verdict: "danger" },
});

describe("roughTripStats", () => {
  it("computes medians over rough trips with snapshots only", () => {
    const r = roughTripStats([rough(10, 1, 1), rough(14, 2, 2), rough(20, 3, 3), { ...rough(99, 9), snapshot: null }, { ...rough(1, 1), rating: "calm" }]);
    expect(r.stats).toMatchObject({ rough_trips: 3, median_wind: 14, median_current: 2 });
    expect(r.trips).toHaveLength(3);
  });
  it("keeps only the latest 8, newest first", () => {
    const r = roughTripStats(Array.from({ length: 10 }, (_, i) => rough(i + 1, 1, i)));
    expect(r.stats.rough_trips).toBe(8);
    expect(r.trips[0].started_at).toBe("2026-10-19 10:00");
  });
  it("handles no rough trips", () => {
    expect(roughTripStats([]).stats).toEqual({ rough_trips: 0, median_wind: 0, avg_wind: 0, median_current: 0, avg_current: 0 });
  });
});

describe("windowForecast", () => {
  it("summarizes the target window from the outlook", () => {
    const target = resolveWindow("tomorrow morning", NOW);
    const outlook = buildZoneOutlook(inputs(), "lower-hudson", "experienced", NOW, nyWallToDate(target.date, target.startHour));
    const f = windowForecast(outlook, target);
    expect(f).toMatchObject({ available: true, date: "2026-10-27", hours: 5, windKnots: 5, windDirection: "S", currentKnots: 0.6, currentPhase: "flood" });
    expect(f.verdict).toBe("safe");
  });
  it("uses the first 12 hours for 'now'", () => {
    const outlook = buildZoneOutlook(inputs(), "lower-hudson", "experienced", NOW);
    expect(windowForecast(outlook, resolveWindow("conditions", NOW)).hours).toBe(12);
  });
  it("is unavailable, not calm, when no hour in the window has wind", () => {
    const i = inputs(); i.zones.find((z) => z.zoneId === "lower-hudson")!.wind = null;
    const target = resolveWindow("tomorrow morning", NOW);
    const f = windowForecast(buildZoneOutlook(i, "lower-hudson", "experienced", NOW, nyWallToDate(target.date, target.startHour)), target);
    expect(f).toMatchObject({ available: false, windKnots: null });
  });
  it("names the phase the wind opposes (ebb or flood)", () => {
    const i = inputs(); const z = i.zones.find((x) => x.zoneId === "lower-hudson")!;
    z.current = z.current!.map((c) => ({ ...c, signed: -1, towardDeg: 0 })); // ebb flowing toward N
    z.wind!.periods = z.wind!.periods.map((p) => ({ ...p, fromDeg: 5, direction: "N" })); // from N against the northward ebb
    const target = resolveWindow("tomorrow morning", NOW);
    const f = windowForecast(buildZoneOutlook(i, "lower-hudson", "experienced", NOW, nyWallToDate(target.date, target.startHour)), target);
    expect(f).toMatchObject({ opposingWind: true, opposingPhase: "ebb" });
    z.current = z.current.map((c) => ({ ...c, signed: 1, towardDeg: 0 }));
    expect(windowForecast(buildZoneOutlook(i, "lower-hudson", "experienced", NOW, nyWallToDate(target.date, target.startHour)), target).opposingPhase).toBe("flood");
  });
  it("is unavailable when no hours fall in the window", () => {
    const outlook = buildZoneOutlook(inputs(), "lower-hudson", "experienced", NOW);
    const f = windowForecast(outlook, { label: "x", date: "2030-01-01", startHour: 6, endHour: 11, isNow: false });
    expect(f.available).toBe(false);
    expect(f.windKnots).toBeNull(); expect(f.currentKnots).toBeNull();
  });
});
