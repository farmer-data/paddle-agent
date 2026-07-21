import type { UIMessage } from "ai";
import type { Risk } from "./safety";
import type { CurrentSummary, HourlyRisk, PaddleWindow } from "./windows";

export type PaddleBriefingData = {
  label: string;
  hourly: HourlyRisk[];
  window: PaddleWindow | null;
  current: {
    nowSigned: number | null;
    summary: CurrentSummary;
    caption: string;
  } | null;
};

export type PaddleTripData = {
  tripId: string;
  userId: string;
  route: string;
  rating: "calm" | "moderate" | "rough";
  notes: string;
  startedAt: string;
};

export type PaddleComparisonData = {
  forecast: {
    available: boolean;
    label: string;
    date: string;
    windKnots: number;
    windDirection: string;
    currentKnots: number | null;
    currentPhase: "ebb" | "flood" | null;
    verdict: Risk | null;
    opposingWind: boolean;
  };
  rough: {
    rough_trips: number;
    median_wind: number;
    avg_wind: number;
    median_current: number;
    avg_current: number;
  };
  trips: { trip_id: string; route: string; started_at: string; wind: number; current: number }[];
};

export type PaddleChatDataTypes = {
  "paddle-briefing": PaddleBriefingData;
  "paddle-trip": PaddleTripData;
  "paddle-comparison": PaddleComparisonData;
};

export type PaddleChatUIMessage = UIMessage<unknown, PaddleChatDataTypes>;
