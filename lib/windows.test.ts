import { describe, expect, it } from "vitest";
import type { CurrentPrediction } from "./sources";
import { assessWindow, buildHourlyOutlook, summarizeCurrent, type HourlyRisk } from "./windows";
import { resolveWindow } from "./when";

const TUE_9AM = new Date(2026, 6, 21, 9, 0);

// Wind periods spanning today + the coming Sunday; ISO with Eastern offset.
const wind = [
  { ts: "2026-07-21T09:00:00-04:00", windKnots: 5, direction: "S" },
  { ts: "2026-07-21T10:00:00-04:00", windKnots: 6, direction: "S" },
  { ts: "2026-07-26T06:00:00-04:00", windKnots: 4, direction: "N" },
  { ts: "2026-07-26T07:00:00-04:00", windKnots: 5, direction: "N" },
  { ts: "2026-07-26T08:00:00-04:00", windKnots: 20, direction: "S" }, // strong opposing
  { ts: "2026-07-26T09:00:00-04:00", windKnots: 5, direction: "N" },
  { ts: "2026-07-26T10:00:00-04:00", windKnots: 5, direction: "N" },
  { ts: "2026-07-26T12:00:00-04:00", windKnots: 5, direction: "N" }, // outside morning
];
const current: CurrentPrediction[] = [
  { ts: "2026-07-26 08:00", knots: 2, direction: "ebb" }, // ebb + S wind = opposing
];

describe("buildHourlyOutlook", () => {
  it("filters to the target date + daypart hours", () => {
    const target = resolveWindow("Sunday morning?", TUE_9AM);
    const outlook = buildHourlyOutlook(wind, current, {}, target);
    expect(outlook.map((h) => h.ts.slice(0, 13))).toEqual([
      "2026-07-26T06", "2026-07-26T07", "2026-07-26T08", "2026-07-26T09", "2026-07-26T10",
    ]);
  });

  it("flags the opposing-wind hour as danger", () => {
    const target = resolveWindow("Sunday morning?", TUE_9AM);
    const outlook = buildHourlyOutlook(wind, current, {}, target);
    const eight = outlook.find((h) => h.ts.includes("T08"))!;
    expect(eight.opposing).toBe(true);
    expect(eight.risk).toBe("danger");
  });

  it("takes the first 12 rolling periods when isNow", () => {
    const target = resolveWindow("current conditions", TUE_9AM);
    const outlook = buildHourlyOutlook(wind, current, {}, target);
    expect(outlook.length).toBe(Math.min(12, wind.length));
    expect(outlook[0].ts).toBe("2026-07-21T09:00:00-04:00");
  });
});

describe("assessWindow", () => {
  it("returns the best >=2h safe sub-window and a safe verdict", () => {
    const hourly: HourlyRisk[] = [
      { ts: "a", hourLabel: "9 AM", windKnots: 5, direction: "N", risk: "safe", opposing: false, current: null },
      { ts: "b", hourLabel: "10 AM", windKnots: 5, direction: "N", risk: "safe", opposing: false, current: null },
      { ts: "c", hourLabel: "11 AM", windKnots: 20, direction: "S", risk: "danger", opposing: true, current: null },
    ];
    const out = assessWindow(hourly);
    expect(out.verdict).toBe("safe");
    expect(out.best).toMatchObject({ startIndex: 0, endIndex: 1, risk: "safe" });
    expect(out.opposingWind).toBe(false);
  });

  it("returns danger verdict when no >=2h non-danger window exists", () => {
    const hourly: HourlyRisk[] = [
      { ts: "a", hourLabel: "9 AM", windKnots: 20, direction: "S", risk: "danger", opposing: true, current: null },
      { ts: "b", hourLabel: "10 AM", windKnots: 5, direction: "N", risk: "safe", opposing: false, current: null },
      { ts: "c", hourLabel: "11 AM", windKnots: 20, direction: "S", risk: "danger", opposing: true, current: null },
    ];
    const out = assessWindow(hourly);
    expect(out.verdict).toBe("danger");
    expect(out.best).toBeNull();
    expect(out.opposingWind).toBe(true); // no best window -> evaluate all hours
  });
});

describe("buildHourlyOutlook signed current", () => {
  it("attaches signed current per hour (ebb negative, flood positive, null when missing)", () => {
    const wind = [
      { ts: "2026-07-26T06:00:00-04:00", windKnots: 4, direction: "N" },
      { ts: "2026-07-26T07:00:00-04:00", windKnots: 5, direction: "N" },
      { ts: "2026-07-26T08:00:00-04:00", windKnots: 5, direction: "N" },
    ];
    const currentPreds: CurrentPrediction[] = [
      { ts: "2026-07-26 06:00", knots: 0.5, direction: "ebb" },
      { ts: "2026-07-26 07:00", knots: 0.3, direction: "flood" },
    ];
    const target = resolveWindow("Sunday morning?", TUE_9AM); // 2026-07-26, 06–11
    const out = buildHourlyOutlook(wind, currentPreds, {}, target);
    expect(out.map((h) => h.current)).toEqual([-0.5, 0.3, null]);
  });
});

describe("summarizeCurrent", () => {
  const preds: CurrentPrediction[] = [
    { ts: "2026-07-26 06:00", knots: 1.2, direction: "ebb" },   // -1.2
    { ts: "2026-07-26 07:00", knots: 0.4, direction: "ebb" },   // -0.4
    { ts: "2026-07-26 08:00", knots: 0.6, direction: "flood" }, // +0.6
    { ts: "2026-07-26 09:00", knots: 1.5, direction: "flood" }, // +1.5
  ];

  it("finds peak ebb/flood in the window and the interpolated next turn", () => {
    const s = summarizeCurrent(preds, "2026-07-26 06", "2026-07-26 09");
    expect(s.peakEbb).toEqual({ atLabel: "6 AM", knots: 1.2 });
    expect(s.peakFlood).toEqual({ atLabel: "9 AM", knots: 1.5 });
    // crossing between 07:00 (-0.4) and 08:00 (+0.6): frac 0.4 -> 07:24, turning to flood
    expect(s.nextTurn).toEqual({ atLabel: "7:24 AM", toPhase: "flood" });
  });

  it("returns null turn/peakFlood when ebb runs throughout", () => {
    const ebbOnly: CurrentPrediction[] = [
      { ts: "2026-07-26 06:00", knots: 1.0, direction: "ebb" },
      { ts: "2026-07-26 07:00", knots: 0.8, direction: "ebb" },
    ];
    const s = summarizeCurrent(ebbOnly, "2026-07-26 06", "2026-07-26 07");
    expect(s.nextTurn).toBeNull();
    expect(s.peakFlood).toBeNull();
    expect(s.peakEbb).toEqual({ atLabel: "6 AM", knots: 1.0 });
  });

  it("returns all null for empty predictions", () => {
    expect(summarizeCurrent([], "2026-07-26 06", "2026-07-26 09")).toEqual({ nextTurn: null, peakEbb: null, peakFlood: null });
  });
});
