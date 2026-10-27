import { describe, expect, it } from "vitest";
import { bestWindow, bestWindowText, buildZoneOutlook, gearLine, summarizeCurrent, type HourView } from "./outlook";
import { hourLabel } from "./time";
import { inputs, NOW } from "./test-fixtures";
import type { Verdict } from "./verdict";

const h = (risk: Verdict, key: string) => ({ risk, key, hourLabel: hourLabel(Number(key.slice(11))) }) as HourView;

describe("buildZoneOutlook", () => {
  it("starts at the current NY hour and covers 48 hours", () => {
    const o = buildZoneOutlook(inputs(), "lower-hudson", "beginner", NOW);
    expect(o.hours).toHaveLength(48); expect(o.hours[0].key).toBe("2026-10-26 12");
  });
  it("starts hours at `from` while strip and current stay relative to now", () => {
    const o = buildZoneOutlook(inputs(), "lower-hudson", "beginner", NOW, new Date("2026-10-27T13:00:00Z"));
    expect(o.hours[0].key).toBe("2026-10-27 09");
    expect(o.hours).toHaveLength(48);
    expect(o.strip.label).toBe("Today");
    expect(o.strip.hours[0].key).toBe("2026-10-26 12");
  });
  it("strip runs until sunset today, then switches to tomorrow (NY time, server in UTC)", () => {
    expect(buildZoneOutlook(inputs(), "lower-hudson", "beginner", NOW).strip).toMatchObject({ label: "Today" });
    const late = buildZoneOutlook(inputs(), "lower-hudson", "beginner", new Date("2026-10-27T01:30:00Z")); // 21:30 NY on the 26th
    expect(late.strip.label).toBe("Tomorrow"); expect(late.strip.hours[0].key.slice(0, 10)).toBe("2026-10-27");
  });
  it("greys hours and names the source when wind is stale or a station failed", () => {
    const stale = buildZoneOutlook(inputs({ windUpdatedAt: "2026-10-26T08:00:00Z" }), "lower-hudson", "beginner", NOW);
    expect(stale.strip.hours.every((x) => x.risk === "unknown" || x.risk === "danger")).toBe(true);
    expect(stale.unavailable).toContain("Couldn't reach NWS wind forecast");
    const noCurrent = inputs(); noCurrent.zones.find((z) => z.zoneId === "lower-east")!.current = null;
    expect(buildZoneOutlook(noCurrent, "lower-east", "beginner", NOW).unavailable).toEqual(["Couldn't reach NOAA currents"]);
    expect(buildZoneOutlook(noCurrent, "lower-hudson", "beginner", NOW).unavailable).toEqual([]);
  });
  it("treats an unparseable or future-dated wind timestamp as missing", () => {
    for (const windUpdatedAt of ["garbage", "2026-10-26T20:00:00Z"]) {
      const o = buildZoneOutlook(inputs({ windUpdatedAt }), "lower-hudson", "beginner", NOW);
      expect(o.hours.every((x) => x.missing.includes("wind"))).toBe(true);
      expect(o.unavailable).toContain("Couldn't reach NWS wind forecast");
    }
  });
  it("survives the DST fall-back hour without duplicate keys", () => {
    const o = buildZoneOutlook(inputs({ from: "2026-10-31" }), "lower-hudson", "beginner", new Date("2026-11-01T03:00:00Z"));
    expect(new Set(o.hours.map((x) => x.key)).size).toBe(o.hours.length);
    expect(o.hours).toHaveLength(48);
  });
  it("applies an alert only until it ends", () => {
    const i = inputs(); i.zones.find((z) => z.zoneId === "lower-hudson")!.alerts = [{ event: "Small Craft Advisory", endsAt: "2026-10-26T15:00:00-04:00" }];
    const o = buildZoneOutlook(i, "lower-hudson", "experienced", NOW);
    expect(o.hours.find((x) => x.key === "2026-10-26 14")!.risk).toBe("danger");
    expect(o.hours.find((x) => x.key === "2026-10-26 15")!.risk).toBe("safe");
  });
  it("reports current now, rain badge and water/source failures", () => {
    const i = inputs(); i.rain48hIn = 0.3; i.water = null;
    const o = buildZoneOutlook(i, "lower-hudson", "beginner", NOW);
    expect(o.currentNow).toMatchObject({ nowSigned: 0.6, caption: "Flood — you earn every stroke heading out." });
    expect(o.rainBadge).toBe("Recent heavy rain — sewage overflow likely, avoid water contact");
    expect(o.unavailable).toEqual(["Couldn't reach NOAA water temperature"]);
    expect(o.gear).toBeNull();
    expect(buildZoneOutlook(inputs(), "lower-hudson", "beginner", NOW).rainBadge).toBeNull();
  });
});

describe("bestWindow", () => {
  it("counts a single green hour as a window and never suggests red", () => {
    expect(bestWindow([h("caution", "2026-10-26 14"), h("safe", "2026-10-26 15"), h("caution", "2026-10-26 16")]))
      .toMatchObject({ kind: "green", startLabel: "3 PM", endLabel: "4 PM" });
    expect(bestWindowText(bestWindow([h("danger", "2026-10-26 14"), h("caution", "2026-10-26 15"), h("caution", "2026-10-26 16")])))
      .toEqual({ primary: "No 🟢 window today", secondary: "Least risky: 🟡 3 PM–5 PM" });
    expect(bestWindow([h("danger", "2026-10-26 14"), h("unknown", "2026-10-26 15")])).toEqual({ kind: "none" });
  });
  it("prefers the longest run, earliest on ties, and words Tomorrow", () => {
    const b = bestWindow([h("safe", "2026-10-26 09"), h("danger", "2026-10-26 10"), h("safe", "2026-10-26 11"), h("safe", "2026-10-26 12")]);
    expect(b).toMatchObject({ kind: "green", startKey: "2026-10-26 11", endKey: "2026-10-26 12" });
    expect(bestWindowText(bestWindow([h("safe", "2026-10-26 09"), h("safe", "2026-10-26 10")]), "Tomorrow")).toEqual({ primary: "🟢 Best tomorrow: 9 AM–11 AM", secondary: null });
    expect(bestWindowText({ kind: "none" }, "Tomorrow")).toEqual({ primary: "No 🟢 window tomorrow", secondary: null });
  });
});

describe("gearLine", () => {
  it("shows the gear line, including when the sensor is down in cold season", () => {
    expect(gearLine({ f: 52, at: "2026-11-10 11:50" }, new Date("2026-11-10T17:00:00Z"))).toBe("Water 52 °F — wetsuit or drysuit required");
    expect(gearLine(null, new Date("2026-01-10T17:00:00Z"))).toBe("Water temperature unavailable — assume cold, wetsuit or drysuit required");
    expect(gearLine(null, new Date("2026-08-10T16:00:00Z"))).toBeNull();
    expect(gearLine({ f: 70, at: "2026-08-10 11:50" }, new Date("2026-08-10T16:00:00Z"))).toBeNull();
    expect(gearLine({ f: 52, at: "2026-11-10 08:00" }, new Date("2026-11-10T17:00:00Z"))).toBe("Water temperature unavailable — assume cold, wetsuit or drysuit required");
  });
});

describe("summarizeCurrent", () => {
  it("finds peaks and the next turn", () => {
    const pts = [["06", -1.2], ["07", -0.4], ["08", 0.5], ["09", 1.1]].map(([hh, s]) => ({ ts: `2026-10-26 ${hh}:00`, signed: s as number, towardDeg: 10 }));
    const r = summarizeCurrent(pts, "2026-10-26 06", "2026-10-26 09");
    expect(r.peakEbb).toEqual({ atLabel: "6 AM", knots: 1.2 });
    expect(r.peakFlood).toEqual({ atLabel: "9 AM", knots: 1.1 });
    expect(r.nextTurn).toMatchObject({ toPhase: "flood" });
  });
  it("interpolates a turn across midnight", () => {
    const pts = [["2026-10-26 22:00", -1], ["2026-10-26 23:00", -0.5], ["2026-10-27 00:00", 1.5]].map(([ts, s]) => ({ ts: ts as string, signed: s as number, towardDeg: 10 }));
    expect(summarizeCurrent(pts, "2026-10-26 22", "2026-10-27 00").nextTurn).toEqual({ atLabel: "11:15 PM", toPhase: "flood" });
  });
});
