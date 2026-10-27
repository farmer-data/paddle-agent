import { describe, expect, it } from "vitest";
import { CORRUPT_KEY, deleteTrip, loadPref, loadTrips, saveTrip, savePref, TRIPS_KEY, ZONE_KEY, tripsSchema, requestTripsSchema, toRequestTrip, type Trip } from "./trips";
import { isZoneId } from "./zones";

const fakeStorage = (init: Record<string, string>) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage;
};
const raw = (s: Storage, k: string) => s.getItem(k);
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
  it("sends only the snapshot-relevant trip fields to the server", () => {
    const sent = toRequestTrip({ ...trip("a"), route: "my secret spot", notes: "private notes" });
    expect(Object.keys(sent).sort()).toEqual(["mode", "placeId", "rating", "snapshot", "startedAt", "tripId", "zoneId"]);
    expect(requestTripsSchema.safeParse([sent]).success).toBe(true);
    expect(JSON.stringify(sent)).not.toMatch(/secret|private/);
  });
  it("keeps the valid trips when one entry is invalid, and saves the original aside before rewriting", () => {
    const stored = JSON.stringify([trip("a"), { tripId: 1 }, { ...trip("b"), zoneId: "renamed-zone" }, trip("c")]);
    const s = fakeStorage({ [TRIPS_KEY]: stored });
    expect(loadTrips(s).map((t) => t.tripId)).toEqual(["a", "c"]);
    expect(raw(s, TRIPS_KEY)).toBe(stored); // loading alone writes nothing
    expect(saveTrip(trip("d"), s).map((t) => t.tripId)).toEqual(["a", "c", "d"]);
    expect(raw(s, CORRUPT_KEY)).toBe(stored);
    expect(loadTrips(s).map((t) => t.tripId)).toEqual(["a", "c", "d"]);
  });
  it("moves an unparseable value aside once instead of overwriting it", () => {
    const s = fakeStorage({ [TRIPS_KEY]: "{not json" });
    expect(saveTrip(trip("a"), s).map((t) => t.tripId)).toEqual(["a"]);
    expect(raw(s, CORRUPT_KEY)).toBe("{not json");
    saveTrip(trip("b"), s); deleteTrip("a", s);
    expect(raw(s, CORRUPT_KEY)).toBe("{not json");
    expect(loadTrips(s).map((t) => t.tripId)).toEqual(["b"]);
  });
  it("treats a non-array value as unparseable, and deleteTrip does not wipe it either", () => {
    const s = fakeStorage({ [TRIPS_KEY]: '{"trips":[1]}' });
    deleteTrip("x", s);
    expect(raw(s, CORRUPT_KEY)).toBe('{"trips":[1]}');
  });
  it("does not overwrite a value it could not save aside", () => {
    const m = new Map([[TRIPS_KEY, "{not json"]]);
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { if (k !== TRIPS_KEY) throw new Error("quota"); m.set(k, v); } } as unknown as Storage;
    expect(saveTrip(trip("a"), s).map((t) => t.tripId)).toEqual(["a"]);
    expect(m.get(TRIPS_KEY)).toBe("{not json");
  });
  it("does not overwrite when storage cannot be read", () => {
    const writes: string[] = [];
    const s = { getItem: () => { throw new Error("SecurityError"); }, setItem: (_k: string, v: string) => void writes.push(v) } as unknown as Storage;
    expect(saveTrip(trip("a"), s)).toHaveLength(1);
    expect(writes).toEqual([]);
  });
});
