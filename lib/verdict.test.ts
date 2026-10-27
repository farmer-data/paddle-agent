import { describe, expect, it } from "vitest";
import { zoneById } from "./zones";
import { assessHour, cardinal, type HourConditions } from "./verdict";

const hudson = zoneById("lower-hudson"), east = zoneById("lower-east"), gate = zoneById("hell-gate");
const ok: HourConditions = { windKnots: 5, windFromDeg: 180, currentSigned: 0.6, currentTowardDeg: 11, // S wind with the flood: not opposing
  dischargeCfs: 5000, alerts: [], daylight: true };

describe("assessHour", () => {
  it("bands beginner and experienced thresholds", () => {
    expect(assessHour({ ...ok, windKnots: 8 }, hudson, "beginner").verdict).toBe("caution");
    expect(assessHour({ ...ok, windKnots: 12.5 }, hudson, "beginner").verdict).toBe("danger");
    expect(assessHour({ ...ok, windKnots: 12.5 }, hudson, "experienced").verdict).toBe("caution");
    expect(assessHour({ ...ok, currentSigned: -2.1, currentTowardDeg: 183 }, hudson, "beginner").verdict).toBe("danger");
    expect(assessHour({ ...ok, currentSigned: -2.1, currentTowardDeg: 183 }, hudson, "experienced").verdict).toBe("caution");
  });
  it("never returns safe when a source is missing", () => {
    for (const patch of [{ windKnots: null }, { currentSigned: null }, { alerts: null }, { dischargeCfs: null }])
      expect(assessHour({ ...ok, ...patch }, hudson, "beginner").verdict).toBe("unknown");
    expect(assessHour({ ...ok, dischargeCfs: null }, east, "beginner").verdict).toBe("safe"); // flow ignored on East River
    expect(assessHour({ ...ok, dischargeCfs: null }, hudson, "beginner").missing).toEqual(["flow"]);
  });
  it("keeps known danger even with missing data", () => {
    expect(assessHour({ ...ok, alerts: null, daylight: false }, hudson, "beginner").verdict).toBe("danger");
    expect(assessHour({ ...ok, windKnots: null }, gate, "beginner").verdict).toBe("danger");
    expect(assessHour({ ...ok, currentSigned: null, alerts: ["Small Craft Advisory"] }, hudson, "experienced").verdict).toBe("danger");
  });
  it("treats Hell Gate normally for experienced paddlers", () => expect(assessHour(ok, gate, "experienced").verdict).toBe("safe"));
  it("detects wind against current from each zone's own heading", () => {
    // Hudson ebb flows toward 183°; a south wind (from 180°) opposes it.
    expect(assessHour({ ...ok, windKnots: 6, windFromDeg: 180, currentSigned: -0.8, currentTowardDeg: 183 }, hudson, "beginner"))
      .toMatchObject({ opposing: true, verdict: "caution" });
    // East River ebb flows toward 234° at the Brooklyn Bridge; a SW wind (225°) opposes it, a S wind (180°) does not.
    expect(assessHour({ ...ok, windFromDeg: 225, currentSigned: -0.8, currentTowardDeg: 234 }, east, "beginner").opposing).toBe(true);
    expect(assessHour({ ...ok, windFromDeg: 180, currentSigned: -0.8, currentTowardDeg: 234 }, east, "beginner").opposing).toBe(false);
    expect(assessHour({ ...ok, windFromDeg: 180, currentSigned: -0.3, currentTowardDeg: 183 }, hudson, "beginner").opposing).toBe(false);
  });
  it("writes reasons, most severe first", () => {
    expect(assessHour({ ...ok, windKnots: 14, windFromDeg: 180, currentSigned: -1.2, currentTowardDeg: 183 }, hudson, "beginner").reasons[0])
      .toBe("Wind 14 kn from S, against the current");
    expect(assessHour(ok, gate, "beginner").reasons[0]).toBe("Hell Gate — Not for first-season paddlers");
  });
  it("writes the other reason strings", () => {
    const r = assessHour({ ...ok, daylight: false, alerts: ["Gale Warning"], currentSigned: -1.2, currentTowardDeg: 183, dischargeCfs: 30000 }, hudson, "beginner").reasons;
    expect(r).toEqual(expect.arrayContaining(["Outside daylight hours", "Gale Warning in effect", "Current 1.2 kn ebb", "Hudson flow 30,000 cfs"]));
    expect(r.slice(0, 3)).toEqual(["Outside daylight hours", "Gale Warning in effect", "Hudson flow 30,000 cfs"]);
  });
});

describe("cardinal", () => {
  it("maps degrees to 16 points", () => {
    expect(cardinal(0)).toBe("N");
    expect(cardinal(225)).toBe("SW");
    expect(cardinal(359)).toBe("N");
    expect(cardinal(-90)).toBe("W");
  });
});
