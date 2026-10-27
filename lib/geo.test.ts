import { describe, expect, it } from "vitest";
import { angleDiff, bearingDeg, distanceNm, lerp, pointInPolygon } from "./geo";
import type { LonLat } from "./zones";

describe("geo helpers", () => {
  it("measures angle differences across north", () => { expect(angleDiff(350, 10)).toBe(20); expect(angleDiff(183, 3)).toBe(180); });
  it("measures ~1 nm per minute of latitude", () => expect(distanceNm([-74, 40.70], [-74, 40.7166667])).toBeCloseTo(1, 1));
  it("gives compass bearings", () => {
    expect(bearingDeg([-74, 40.7], [-74, 40.8])).toBeCloseTo(0, 0);
    expect(bearingDeg([-74, 40.7], [-73.9, 40.7])).toBeCloseTo(90, 0);
    expect(bearingDeg([-74, 40.7], [-74, 40.6])).toBeCloseTo(180, 0);
    expect(bearingDeg([-74, 40.7], [-74.1, 40.7])).toBeCloseTo(270, 0);
  });
  it("tests points against a polygon", () => {
    const square: LonLat[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(pointInPolygon([0.5, 0.5], square)).toBe(true);
    expect(pointInPolygon([1.5, 0.5], square)).toBe(false);
  });
  it("interpolates between points", () => expect(lerp([0, 0], [2, 4], 0.25)).toEqual([0.5, 1]));
});
