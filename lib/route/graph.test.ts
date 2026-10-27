import { describe, expect, it } from "vitest";
import { distanceNm, lerp } from "../geo";
import { PLACES, zoneAt } from "../zones";
import { EDGES, NODES, findPlace, shortestPath } from "./graph";

const node = (id: string) => NODES.find((n) => n.id === id)!;

describe("waterway graph", () => {
  it("keeps every edge on the water (inside some zone polygon)", () => {
    for (const e of EDGES) for (let t = 0; t <= 1; t += 0.05) {
      const p = lerp(node(e.a).lonLat, node(e.b).lonLat, t);
      expect(zoneAt(p), `${e.a}->${e.b} @${t.toFixed(2)}`).not.toBeNull();
    }
  });
  it("connects every place to every other place when crossings are allowed", () => {
    for (const a of PLACES) for (const b of PLACES) if (a !== b) expect(shortestPath(a.nodeId, b.nodeId, { allowCrossings: true }), `${a.id}->${b.id}`).not.toBeNull();
  });
  it("routes Hudson to East River around the Battery without crossings", () => {
    const r = shortestPath(findPlace("pier 40")!.nodeId, findPlace("brooklyn bridge")!.nodeId, { allowCrossings: false })!;
    expect(r.edges.some((e) => e.zoneId === "lower-hudson") && r.edges.some((e) => e.zoneId === "lower-east")).toBe(true);
  });
  it("needs a crossing from Hoboken to Manhattan", () => {
    expect(shortestPath(findPlace("hoboken")!.nodeId, findPlace("pier 40")!.nodeId, { allowCrossings: false })).toBeNull();
    expect(shortestPath(findPlace("hoboken")!.nodeId, findPlace("pier 40")!.nodeId, { allowCrossings: true })!.edges.some((e) => e.kind === "crossing")).toBe(true);
  });
  it("finds places by alias", () => {
    expect(findPlace("Pier40")?.id).toBe(findPlace("pier 40")?.id);
    expect(findPlace("the intrepid")?.kind).toBe("landmark");
    expect(findPlace("nowhere special")).toBeNull();
  });
  it("prefers the longest alias", () => expect(findPlace("hunters point south")?.id).toBe("hunters-point-south"));
  it("computes edge length and zone at load, and has 2-4 crossings per river", () => {
    for (const e of EDGES) { expect(e.nm).toBeCloseTo(distanceNm(node(e.a).lonLat, node(e.b).lonLat), 6); expect(e.nm).toBeGreaterThan(0); expect(e.nm, `${e.a}-${e.b}`).toBeLessThan(0.9); }
    const hudson = new Set(["upper-hudson", "midtown-hudson", "lower-hudson"]);
    const cross = EDGES.filter((e) => e.kind === "crossing");
    expect(cross.filter((e) => hudson.has(e.zoneId)).length).toBeGreaterThanOrEqual(2);
    expect(cross.filter((e) => hudson.has(e.zoneId)).length).toBeLessThanOrEqual(4);
    expect(cross.filter((e) => !hudson.has(e.zoneId)).length).toBeGreaterThanOrEqual(2);
    expect(cross.filter((e) => !hudson.has(e.zoneId)).length).toBeLessThanOrEqual(4);
  });
  it("points every place at its nearest node on its own bank", () => {
    for (const p of PLACES) {
      const n = node(p.nodeId);
      expect(n, p.id).toBeDefined();
      const best = Math.min(...NODES.filter((m) => m.bank === n.bank).map((m) => distanceNm(p.lonLat, m.lonLat)));
      expect(distanceNm(p.lonLat, n.lonLat), p.id).toBeCloseTo(best, 9);
      expect(distanceNm(p.lonLat, n.lonLat), p.id).toBeLessThan(0.35);
    }
  });
  it("returns a zero-length path to itself and null for unknown nodes", () => {
    expect(shortestPath("m01", "m01", { allowCrossings: false })).toEqual({ nodes: ["m01"], edges: [] });
    expect(shortestPath("m01", "zz", { allowCrossings: true })).toBeNull();
  });
});
