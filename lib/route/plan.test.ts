import { describe, expect, it } from "vitest";
import type { Mode } from "../config";
import { buildZoneOutlook, type ZoneOutlook } from "../outlook";
import { inputs, NOW } from "../test-fixtures";
import { hourKey } from "../time";
import { PLACES, ZONES, type ZoneId } from "../zones";
import { findPlace, NODES } from "./graph";
import { planRoute, summarizeRoute } from "./plan";

type Outlooks = Record<ZoneId, ZoneOutlook>;
const build = (data: ReturnType<typeof inputs>, mode: Mode = "beginner") =>
  Object.fromEntries(ZONES.map((z) => [z.id, buildZoneOutlook(data, z.id, mode, NOW)])) as Outlooks;

const calm = (mode: Mode = "beginner") => build(inputs(), mode);
const outlooksWith = (cur: { signed: number; towardDeg: number }, mode: Mode = "beginner") => {
  const data = inputs();
  for (const z of data.zones) z.current = z.current!.map((c) => ({ ...c, ...cur }));
  return build(data, mode);
};
// 9 kn wind (beginner caution) before `key` ("YYYY-MM-DD HH"), calm after.
const cautionUntil = (key: string, mode: Mode = "beginner") => {
  const data = inputs();
  for (const z of data.zones) z.wind!.periods = z.wind!.periods.map((p) => (hourKey(p.ts) < key ? { ...p, windKnots: 9 } : p));
  return build(data, mode);
};
const launchIn = (zone: ZoneId) => PLACES.find((p) => p.kind === "launch" && p.zoneId === zone)!.id;
const node = (id: string) => NODES.find((n) => n.id === id)!;

describe("planRoute", () => {
  it("is faster with the current than against it", () => {
    const ebb = outlooksWith({ signed: -1.5, towardDeg: 183 });
    const south = planRoute({ fromId: "pier-96", toId: "pier-40", depart: "2026-10-26 13:00" }, ebb, "experienced", NOW);
    const north = planRoute({ fromId: "pier-40", toId: "pier-96", depart: "2026-10-26 13:00" }, ebb, "experienced", NOW);
    expect(south.durationMin).toBeLessThan(north.durationMin);
    expect(south.distanceNm).toBeCloseTo(north.distanceNm, 5);
  });
  it("flags no headway when the current beats the paddler", () => {
    const p = planRoute({ fromId: "pier-40", toId: "pier-96", depart: "2026-10-26 13:00" }, outlooksWith({ signed: -3.2, towardDeg: 183 }), "beginner", NOW);
    expect(p.segments.some((s) => s.warning === "You won't make headway here")).toBe(true);
  });
  it("blocks Hell Gate and river crossings for beginners, with no suggestion", () => {
    const gate = planRoute({ fromId: launchIn("midtown-east"), toId: launchIn("hell-gate"), depart: "2026-10-26 13:00" }, calm(), "beginner", NOW);
    expect(gate).toMatchObject({ blocked: "hell-gate", worst: "danger", suggestion: null });
    const cross = planRoute({ fromId: "hoboken-cove", toId: "pier-40", depart: "2026-10-26 13:00" }, calm(), "beginner", NOW);
    expect(cross.blocked).toBe("crossing"); expect(cross.warnings).toContain("Crosses a ferry lane — not for first-season paddlers");
  });
  it("allows crossings for experienced paddlers with a ferry warning", () => {
    const p = planRoute({ fromId: "hoboken-cove", toId: "pier-40", depart: "2026-10-26 13:00" }, calm("experienced"), "experienced", NOW);
    expect(p.blocked).toBeNull();
    expect(p.segments.find((s) => s.kind === "crossing")!.warning).toBe("Ferry lane — cross quickly, look both ways, cross at a right angle");
  });
  it("suggests the quickest all-green departure before sunset", () => {
    const p = planRoute({ fromId: "pier-40", toId: "pier-96", depart: "2026-10-26 12:00" }, cautionUntil("2026-10-26 14"), "beginner", NOW);
    expect(p.suggestion).toMatchObject({ allGreen: true }); expect(p.suggestion!.depart >= "2026-10-26 14:00").toBe(true);
    expect(p.caveat).toBe("Planning estimate, not a guarantee of safe passage.");
  });
  it("returns on the reverse path after the turnaround", () => {
    const p = planRoute({ fromId: "pier-40", toId: "pier-96", depart: "2026-10-26 13:00", outAndBack: true, turnaround: "2026-10-26 15:00" }, calm("experienced"), "experienced", NOW);
    expect(p.segments.at(-1)!.to).toEqual(node(findPlace("pier 40")!.nodeId).lonLat); expect(p.eta > "2026-10-26 15:00").toBe(true);
  });
  it("marks segments past the outlook horizon unknown and summarizes in one line", () => {
    const p = planRoute({ fromId: "pier-40", toId: "pier-96", depart: "2026-10-30 13:00" }, calm(), "beginner", NOW);
    expect(p.segments.every((s) => s.risk === "unknown")).toBe(true);
    expect(summarizeRoute(p)).not.toContain("\n");
  });
});
