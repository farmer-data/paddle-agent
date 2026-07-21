import { describe, expect, it } from "vitest";
import { buildQuickBriefing, type Condition } from "./briefing";

const reading = (parameter: string, value: number): Condition => ({ parameter, value, ts: "2026-07-21 08:06" });

describe("buildQuickBriefing current direction", () => {
  it("treats a southward current_dir as ebb, so a southerly wind opposes it", () => {
    const briefing = buildQuickBriefing([
      reading("current_dir", 183), // ebb (flowing south)
      reading("current_speed", 1.6),
      reading("wind_speed", 12),
      reading("wind_dir", 180), // wind from the south
    ]);
    expect(briefing.assessment.opposingWind).toBe(true);
  });

  it("treats a northward current_dir as flood, so a southerly wind does NOT oppose it", () => {
    const briefing = buildQuickBriefing([
      reading("current_dir", 11), // flood (flowing north)
      reading("current_speed", 1.6),
      reading("wind_speed", 12),
      reading("wind_dir", 180), // wind from the south
    ]);
    expect(briefing.assessment.opposingWind).toBe(false);
  });

  it("falls back to ebb when current_dir is absent (preserves prior behavior)", () => {
    const briefing = buildQuickBriefing([
      reading("wind_speed", 12),
      reading("wind_dir", 180),
    ]);
    expect(briefing.assessment.opposingWind).toBe(true);
  });
});
