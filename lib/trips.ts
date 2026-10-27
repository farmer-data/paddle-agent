// Browser-safe: no server-only imports.
import { z } from "zod";
import type { Mode } from "./config";
import type { Verdict } from "./verdict";
import { isZoneId, type ZoneId } from "./zones";

export const TRIPS_KEY = "paddle-agent:trips:v1";
export const CORRUPT_KEY = "paddle-agent:trips:v1:corrupt";
export const ZONE_KEY = "paddle-agent:zone";
export const MODE_KEY = "paddle-agent:mode";
const MAX_TRIPS = 50;

export type TripSnapshot = { windKnots: number; windFromDeg: number | null; currentKnots: number; currentPhase: "ebb" | "flood"; verdict: Verdict };
export type Trip = {
  tripId: string; route: string; zoneId: ZoneId; placeId: string | null; rating: "calm" | "moderate" | "rough";
  notes: string; startedAt: string; mode: Mode; snapshot: TripSnapshot | null;
};

const snapshotSchema = z.object({
  windKnots: z.number().finite(), windFromDeg: z.number().finite().nullable(), currentKnots: z.number().finite(),
  currentPhase: z.enum(["ebb", "flood"]), verdict: z.enum(["safe", "caution", "danger", "unknown"]),
});
const tripSchema = z.object({
  tripId: z.string().min(1).max(100), route: z.string().max(300),
  zoneId: z.custom<ZoneId>(isZoneId), placeId: z.string().max(100).nullable(),
  rating: z.enum(["calm", "moderate", "rough"]), notes: z.string().max(2000),
  startedAt: z.string().max(40), mode: z.enum(["beginner", "experienced"]), snapshot: snapshotSchema.nullable(),
});
export const tripsSchema = z.array(tripSchema).max(MAX_TRIPS);

// What the chat request carries: the snapshot-relevant fields only. Route text and notes stay in the browser.
export type RequestTrip = Pick<Trip, "tripId" | "zoneId" | "placeId" | "rating" | "startedAt" | "mode" | "snapshot">;
export const requestTripsSchema = z.array(tripSchema.pick({ tripId: true, zoneId: true, placeId: true, rating: true, startedAt: true, mode: true, snapshot: true })).max(MAX_TRIPS);
export const toRequestTrip = (t: Trip): RequestTrip => ({ tripId: t.tripId, zoneId: t.zoneId, placeId: t.placeId, rating: t.rating, startedAt: t.startedAt, mode: t.mode, snapshot: t.snapshot });

const defaultStorage = (): Storage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

type StoredTrips = { trips: Trip[]; raw: string | null; status: "ok" | "partial" | "corrupt" | "unreadable" };

// Entries are validated one by one so a single bad entry (corruption, or a future schema change) cannot discard the rest.
function readTrips(storage: Storage | null): StoredTrips {
  let raw: string | null;
  try { raw = storage?.getItem(TRIPS_KEY) ?? null; } catch { return { trips: [], raw: null, status: "unreadable" }; }
  if (!raw) return { trips: [], raw: null, status: "ok" };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { trips: [], raw, status: "corrupt" }; }
  if (!Array.isArray(parsed)) return { trips: [], raw, status: "corrupt" };
  const trips = parsed.flatMap((entry) => { const r = tripSchema.safeParse(entry); return r.success ? [r.data as Trip] : []; });
  return { trips, raw, status: trips.length === parsed.length ? "ok" : "partial" };
}

export function loadTrips(storage: Storage | null = defaultStorage()): Trip[] {
  return readTrips(storage).trips.slice(-MAX_TRIPS);
}

// Before a write replaces what is stored, keep a copy of anything that would be lost. Returns false if that copy could not be made.
function keepRawAside(raw: string, storage: Storage): boolean {
  try {
    const taken = storage.getItem(CORRUPT_KEY);
    storage.setItem(taken === null || taken === raw ? CORRUPT_KEY : `${CORRUPT_KEY}:${Date.now()}`, raw);
    return true;
  } catch { return false; }
}

// Read, then write the result of `change`. Never replaces a stored value it could not fully read without saving it aside first.
function update(storage: Storage | null, change: (existing: Trip[]) => Trip[]): Trip[] {
  const stored = readTrips(storage);
  const next = change(stored.trips).slice(-MAX_TRIPS);
  if (!storage || stored.status === "unreadable") return next; // keep going in memory only
  if ((stored.status === "corrupt" || stored.status === "partial") && stored.raw !== null && !keepRawAside(stored.raw, storage)) return next;
  try { storage.setItem(TRIPS_KEY, JSON.stringify(next)); } catch { /* storage unavailable or full: keep going in memory */ }
  return next;
}

export function saveTrip(trip: Trip, storage: Storage | null = defaultStorage()): Trip[] {
  return update(storage, (existing) => {
    const i = existing.findIndex((t) => t.tripId === trip.tripId);
    return i >= 0 ? existing.map((t, j) => (j === i ? trip : t)) : [...existing, trip];
  });
}

export function deleteTrip(id: string, storage: Storage | null = defaultStorage()): Trip[] {
  return update(storage, (existing) => existing.filter((t) => t.tripId !== id));
}

export function loadPref<T>(key: string, isValid: (x: unknown) => x is T, fallback: T, storage: Storage | null = defaultStorage()): T {
  try {
    const raw = storage?.getItem(key);
    return raw != null && isValid(raw) ? raw : fallback;
  } catch { return fallback; }
}

export function savePref(key: string, value: string, storage: Storage | null = defaultStorage()) {
  try { storage?.setItem(key, value); } catch { /* ignore */ }
}
