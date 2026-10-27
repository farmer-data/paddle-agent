import { describe, expect, it } from "vitest";
import { addDays, hourKey, hourLabel, nyParts, nyStamp, nyWallToDate, sunTimes, wallMinutes, wallStamp } from "./time";

describe("NY time helpers", () => {
  it("uses New York wall clock even when UTC is the next day", () => {
    expect(nyParts(new Date("2026-07-26T01:30:00Z"))).toMatchObject({ date: "2026-07-25", hour: 21, minute: 30 });
    expect(nyStamp(new Date("2026-12-01T17:05:00Z"))).toBe("2026-12-01 12:05");
  });
  it("round-trips wall minutes", () => expect(wallStamp(wallMinutes("2026-07-26 14:45") + 30)).toBe("2026-07-26 15:15"));
  it("labels hours", () => { expect(hourLabel(0)).toBe("12 AM"); expect(hourLabel(15)).toBe("3 PM"); });
  it("gives NY sunrise/sunset", () => {
    const { sunrise, sunset } = sunTimes("2026-10-26", [-74.0, 40.75]);
    expect(sunrise.slice(0, 13)).toBe("2026-10-26 07"); expect(sunset.slice(0, 13)).toBe("2026-10-26 17");
  });
  it("reports the NY day of week", () => expect(nyParts(new Date("2026-07-26T01:30:00Z")).dow).toBe(6));
  it("keys hours from NWS and NOAA stamps alike", () => {
    expect(hourKey("2026-07-26T06:00:00-04:00")).toBe("2026-07-26 06");
    expect(hourKey("2026-07-26 06:00")).toBe("2026-07-26 06");
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 2)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("converts a NY wall hour to the right instant across DST", () => {
    expect(nyWallToDate("2026-10-26", 12).toISOString()).toBe("2026-10-26T16:00:00.000Z");
    expect(nyWallToDate("2026-12-01", 12).toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(nyWallToDate("2026-11-01", 1).toISOString()).toBe("2026-11-01T05:00:00.000Z"); // first of the repeated hours
    expect(nyWallToDate("2026-11-01", 3).toISOString()).toBe("2026-11-01T08:00:00.000Z");
  });
});
