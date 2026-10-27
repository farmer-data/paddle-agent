import { describe, expect, it } from "vitest";
import { PLACES, ZONES, isZoneId, nearestZone, zoneAt, zoneById, type LonLat, type ZoneId } from "./zones";

const STATIONS: Record<ZoneId, LonLat> = { "upper-hudson": [-73.9498, 40.8496], "midtown-hudson": [-74.0028, 40.7707],
  "lower-hudson": [-74.0253, 40.7076], "lower-east": [-73.9977, 40.706], "midtown-east": [-73.9657, 40.7347], "hell-gate": [-73.9383, 40.7783] };

describe("zones", () => {
  it("has six zones whose polygons contain their centre and current station", () => {
    expect(ZONES.map((z) => z.id).sort()).toEqual(Object.keys(STATIONS).sort());
    for (const z of ZONES) { expect(zoneAt(z.center)).toBe(z.id); expect(zoneAt(STATIONS[z.id])).toBe(z.id); }
  });
  it("flags flow and Hell Gate correctly", () => {
    expect(ZONES.filter((z) => z.usesHudsonFlow).map((z) => z.river)).toEqual(["hudson", "hudson", "hudson"]);
    expect(ZONES.filter((z) => z.beginnerNoGo).map((z) => z.id)).toEqual(["hell-gate"]);
  });
  it("has at least one launch per zone and unique place ids", () => {
    for (const z of ZONES) expect(PLACES.some((p) => p.kind === "launch" && p.zoneId === z.id)).toBe(true);
    expect(new Set(PLACES.map((p) => p.id)).size).toBe(PLACES.length);
  });
  it("finds the nearest zone from land", () => expect(nearestZone([-73.99, 40.735])).toMatch(/hudson|east/));
  it("puts every place inside its own zone", () => {
    for (const p of PLACES) expect(zoneAt(p.lonLat), p.id).toBe(p.zoneId);
  });
  it("draws 10–40 vertex shapes and neighbours share a boundary edge", () => {
    for (const z of ZONES) { expect(z.shape.length, z.id).toBeGreaterThanOrEqual(10); expect(z.shape.length, z.id).toBeLessThanOrEqual(40); }
    const edges = (id: ZoneId) => zoneById(id).shape.map((p, i, s) => `${p}|${s[(i + 1) % s.length]}`);
    const neighbours: [ZoneId, ZoneId][] = [["upper-hudson", "midtown-hudson"], ["midtown-hudson", "lower-hudson"], ["lower-hudson", "lower-east"], ["lower-east", "midtown-east"], ["midtown-east", "hell-gate"]];
    for (const [a, b] of neighbours) {
      const reversed = new Set(edges(b).map((e) => e.split("|").reverse().join("|")));
      expect(edges(a).some((e) => reversed.has(e)), `${a}/${b}`).toBe(true);
    }
  });
  it("looks zones up by id", () => {
    expect(zoneById("hell-gate").currentStation).toBe("NYH1924");
    expect(isZoneId("lower-east")).toBe(true);
    expect(isZoneId("harlem")).toBe(false);
  });
});
