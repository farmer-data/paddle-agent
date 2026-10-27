export type Mode = "beginner" | "experienced";

export const CONFIG = {
  thresholds: {
    beginner:    { wind: { caution: 8,  danger: 12 }, current: { caution: 1.0, danger: 2.0 } },
    experienced: { wind: { caution: 12, danger: 18 }, current: { caution: 2.0, danger: 3.0 } },
    flow: { caution: 15_000, danger: 25_000 },
  },
  opposing: { maxAngleDeg: 45, minCurrentKn: 0.5 }, // min current: builder's call per spec
  noGoAlerts: ["Small Craft Advisory", "Gale Warning", "Storm Warning", "Hurricane Force Wind Warning",
    "Special Marine Warning", "Severe Thunderstorm Warning", "Tropical Storm Warning", "Hurricane Warning"],
  coldWaterF: 60,
  coldSeasonMonths: [11, 12, 1, 2, 3, 4, 5, 6], // Nov 1 – Jun 30
  rainBadgeInches48h: 0.25,
  maxAge: { observationMin: 90, forecastHours: 6, forecastUpdateHours: 24, alertsMin: 20 },
  marineZones: ["ANZ338"], // NWS marine zones queried for every paddling zone (New York Harbor)
  outlookHours: 48,
  route: { paddleKn: { beginner: 2.5, experienced: 3.5 }, headwindPenalty: 0.1, minHeadwayKn: 0.5, stepMin: 15, maxHours: 8, departureStepMin: 30 },
  chat: { maxMessageChars: 500, maxHistoryChars: 24_000, historyMessages: 12, maxTrips: 50, maxSteps: 4, maxOutputTokens: 1200 },
  rateLimit: { perIpHour: 20, perIpDay: 50, siteDay: 500 },
} as const;
