import { describe, expect, it } from "vitest";
import type { CurrentPrediction } from "./sources";
import { assessWindow, buildHourlyOutlook, type HourlyRisk } from "./windows";
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
      { ts: "a", hourLabel: "9 AM", windKnots: 5, direction: "N", risk: "safe", opposing: false },
      { ts: "b", hourLabel: "10 AM", windKnots: 5, direction: "N", risk: "safe", opposing: false },
      { ts: "c", hourLabel: "11 AM", windKnots: 20, direction: "S", risk: "danger", opposing: true },
    ];
    const out = assessWindow(hourly);
    expect(out.verdict).toBe("safe");
    expect(out.best).toMatchObject({ startIndex: 0, endIndex: 1, risk: "safe" });
    expect(out.opposingWind).toBe(false);
  });

  it("returns danger verdict when no >=2h non-danger window exists", () => {
    const hourly: HourlyRisk[] = [
      { ts: "a", hourLabel: "9 AM", windKnots: 20, direction: "S", risk: "danger", opposing: true },
      { ts: "b", hourLabel: "10 AM", windKnots: 5, direction: "N", risk: "safe", opposing: false },
      { ts: "c", hourLabel: "11 AM", windKnots: 20, direction: "S", risk: "danger", opposing: true },
    ];
    const out = assessWindow(hourly);
    expect(out.verdict).toBe("danger");
    expect(out.best).toBeNull();
    expect(out.opposingWind).toBe(true); // no best window -> evaluate all hours
  });
});
