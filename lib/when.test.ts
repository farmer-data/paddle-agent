import { describe, expect, it } from "vitest";
import { resolveWindow } from "./when";

// 2026-07-21 is a Tuesday.
const TUE_9AM = new Date("2026-07-21T13:00:00Z");

describe("resolveWindow", () => {
  it("resolves 'tomorrow' from New York's date, not UTC's", () => {
    expect(resolveWindow("tomorrow morning", new Date("2026-07-26T02:00:00Z"))).toMatchObject({ date: "2026-07-26", startHour: 6 }); // 22:00 NY on Jul 25
  });

  it("uses New York's hour and weekday for 'now'", () => {
    const w = resolveWindow("conditions?", new Date("2026-07-26T02:00:00Z"));
    expect(w).toMatchObject({ isNow: true, date: "2026-07-25", startHour: 22 });
    // Saturday 22:00 NY: 'sunday' is tomorrow, not today (UTC says it is already Sunday).
    expect(resolveWindow("sunday", new Date("2026-07-26T02:00:00Z")).date).toBe("2026-07-26");
  });

  it("resolves 'Sunday morning' to the coming Sunday, 6-11", () => {
    const w = resolveWindow("Can I paddle Sunday morning with a beginner?", TUE_9AM);
    expect(w).toMatchObject({ date: "2026-07-26", startHour: 6, endHour: 11, isNow: false, label: "Sunday morning" });
  });

  it("resolves 'tomorrow afternoon'", () => {
    const w = resolveWindow("what about tomorrow afternoon?", TUE_9AM);
    expect(w).toMatchObject({ date: "2026-07-22", startHour: 12, endHour: 17, isNow: false, label: "tomorrow afternoon" });
  });

  it("resolves 'next Monday' to +7 days past the coming Monday", () => {
    const w = resolveWindow("how's next Monday looking", TUE_9AM);
    // coming Monday is 2026-07-27 (+6); "next" adds 7 => 2026-08-03
    expect(w).toMatchObject({ date: "2026-08-03", isNow: false });
  });

  it("resolves a bare weekday to the full day window 6-20", () => {
    const w = resolveWindow("saturday?", TUE_9AM);
    expect(w).toMatchObject({ date: "2026-07-25", startHour: 6, endHour: 20, label: "Saturday", isNow: false });
  });

  it("resolves 'this weekend' to the coming Saturday", () => {
    const w = resolveWindow("thinking about this weekend", TUE_9AM);
    expect(w).toMatchObject({ date: "2026-07-25", label: "Saturday", isNow: false });
  });

  it("treats 'current conditions' as now", () => {
    expect(resolveWindow("Show current Hudson conditions", TUE_9AM).isNow).toBe(true);
  });

  it("treats a question with no time words as now", () => {
    expect(resolveWindow("Find low-wind paddle windows", TUE_9AM).isNow).toBe(true);
  });

  it("treats bare 'today' as now (rolling 12h)", () => {
    expect(resolveWindow("can I go out today", TUE_9AM).isNow).toBe(true);
  });

  it("does not let the tidal-current noun 'current' override a daypart", () => {
    // "current" must not be read as "now" when the question names an evening window.
    const w = resolveWindow("How's the current this evening?", TUE_9AM);
    expect(w).toMatchObject({ isNow: false, startHour: 17, endHour: 20, label: "today evening" });
  });

  it("still resolves an explicit future day when 'current' appears", () => {
    const w = resolveWindow("what's the current doing Sunday morning?", TUE_9AM);
    expect(w).toMatchObject({ isNow: false, date: "2026-07-26", startHour: 6, endHour: 11 });
  });
});
