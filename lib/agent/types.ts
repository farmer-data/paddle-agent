import type { UIMessage } from "ai";
import { z } from "zod";
import type { ForecastSummary } from "../compare";
import type { Mode } from "../config";
import type { BestWindow, CurrentNow, HourView } from "../outlook";
import type { RoutePlan } from "../route/plan";
import { tripsSchema, type Trip } from "../trips";
import { isZoneId, type ZoneId } from "../zones";

export type PaddleBriefingData = {
  zoneId: ZoneId; zoneName: string; mode: Mode; label: string;
  hours: HourView[]; best: BestWindow; bestText: { primary: string; secondary: string | null };
  currentNow: CurrentNow | null; gear: string | null; rainBadge: string | null;
  alerts: string[]; unavailable: string[];
};

export type PaddleComparisonData = {
  forecast: ForecastSummary;
  rough: { rough_trips: number; median_wind: number; avg_wind: number; median_current: number; avg_current: number };
  trips: { trip_id: string; route: string; started_at: string; wind: number; current: number }[];
};

export type PaddleChatDataTypes = {
  "paddle-briefing": PaddleBriefingData;
  "paddle-route": RoutePlan;
  "paddle-trip": Trip;
  "paddle-comparison": PaddleComparisonData;
};

export type PaddleChatUIMessage = UIMessage<unknown, PaddleChatDataTypes>;

export type PaddleDataPart = { [K in keyof PaddleChatDataTypes]: { type: `data-${K}`; data: PaddleChatDataTypes[K] } }[keyof PaddleChatDataTypes];

// The server checks only the envelope; convertToModelMessages validates the parts it understands.
const messageSchema = z.looseObject({
  id: z.string().max(200),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.looseObject({ type: z.string().max(100) })).max(100),
});

export const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(200).transform((m) => m as unknown as UIMessage[]),
  zoneId: z.custom<ZoneId>(isZoneId, "Unknown zone"),
  mode: z.enum(["beginner", "experienced"]),
  trips: tripsSchema,
});
