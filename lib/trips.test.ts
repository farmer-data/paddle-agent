import { describe, expect, it } from "vitest";
import { deleteTrip, loadPref, loadTrips, saveTrip, savePref, TRIPS_KEY, ZONE_KEY, tripsSchema, type Trip } from "./trips";
import { isZoneId } from "./zones";

const fakeStorage = (init: Record<string, string>) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage;
};
const trip = (id: string): Trip => ({ tripId: id, route: "Pier 40 to Pier 25", zoneId: "lower-hudson", placeId: null, rating: "calm", notes: "", startedAt: "2026-10-20 10:00", mode: "beginner", snapshot: null });

describe("trips storage", () => {
  it("returns [] and defaults when storage is missing, throws, or holds junk", () => {
    expect(loadTrips(null)).toEqual([]);
    expect(loadTrips({ getItem: () => { throw new Error("SecurityError"); } } as unknown as Storage)).toEqual([]);
    expect(loadTrips(fakeStorage({ [TRIPS_KEY]: "{not json" }))).toEqual([]);
    expect(loadTrips(fakeStorage({ [TRIPS_KEY]: JSON.stringify([{ tripId: 1 }]) }))).toEqual([]);
    expect(loadPref(ZONE_KEY, isZoneId, "lower-hudson", fakeStorage({ [ZONE_KEY]: "atlantis" }))).toBe("lower-hudson");
  });
  it("upserts and deletes", () => {
    const s = fakeStorage({}); saveTrip(trip("a"), s); saveTrip({ ...trip("a"), notes: "x" }, s);
    expect(loadTrips(s)).toHaveLength(1); expect(loadTrips(s)[0].notes).toBe("x");
    expect(deleteTrip("a", s)).toEqual([]);
  });
  it("round-trips prefs and survives a throwing setItem", () => {
    const s = fakeStorage({}); savePref(ZONE_KEY, "hell-gate", s);
    expect(loadPref(ZONE_KEY, isZoneId, "lower-hudson", s)).toBe("hell-gate");
    expect(() => savePref(ZONE_KEY, "x", { setItem: () => { throw new Error("quota"); } } as unknown as Storage)).not.toThrow();
  });
  it("caps the list at 50, keeping the newest", () => {
    const s = fakeStorage({});
    for (let i = 0; i < 52; i++) saveTrip(trip(`t${i}`), s);
    const all = loadTrips(s);
    expect(all).toHaveLength(50);
    expect(all[0].tripId).toBe("t2");
  });
  it("schema rejects more than 50 trips", () => {
    expect(tripsSchema.safeParse(Array.from({ length: 51 }, (_, i) => trip(`t${i}`))).success).toBe(false);
  });
});
