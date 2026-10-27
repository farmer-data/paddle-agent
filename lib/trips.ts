// Browser-safe: no server-only imports.
import { z } from "zod";
import type { Mode } from "./config";
import type { Verdict } from "./verdict";
import { isZoneId, type ZoneId } from "./zones";

export const TRIPS_KEY = "paddle-agent:trips:v1";
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

const defaultStorage = (): Storage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

export function loadTrips(storage: Storage | null = defaultStorage()): Trip[] {
  try {
    const raw = storage?.getItem(TRIPS_KEY);
    if (!raw) return [];
    const parsed = tripsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as Trip[]) : [];
  } catch { return []; }
}

function persist(trips: Trip[], storage: Storage | null) {
  try { storage?.setItem(TRIPS_KEY, JSON.stringify(trips)); } catch { /* storage unavailable or full: keep going in memory */ }
  return trips;
}

export function saveTrip(trip: Trip, storage: Storage | null = defaultStorage()): Trip[] {
  const existing = loadTrips(storage);
  const i = existing.findIndex((t) => t.tripId === trip.tripId);
  const next = i >= 0 ? existing.map((t, j) => (j === i ? trip : t)) : [...existing, trip];
  return persist(next.slice(-MAX_TRIPS), storage);
}

export function deleteTrip(id: string, storage: Storage | null = defaultStorage()): Trip[] {
  return persist(loadTrips(storage).filter((t) => t.tripId !== id), storage);
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
