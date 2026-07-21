export type Risk = "safe" | "caution" | "danger";
export type Conditions = { dischargeCfs?: number; currentKnots?: number; windKnots?: number; windDirection?: number; currentDirection?: "ebb" | "flood" };

const rank: Record<Risk, number> = { safe: 0, caution: 1, danger: 2 };
const fromRank = (value: number): Risk => value >= 2 ? "danger" : value === 1 ? "caution" : "safe";
const band = (value: number | undefined, caution: number, danger: number): Risk =>
  value === undefined ? "safe" : value > danger ? "danger" : value >= caution ? "caution" : "safe";

export function assessSafety(input: Conditions) {
  const discharge = band(input.dischargeCfs, 15_000, 25_000);
  const current = band(input.currentKnots, 1.5, 2.5);
  let wind = band(input.windKnots, 10, 15);
  // Ebb flows south; a southerly wind opposes it. Flood is the converse.
  const opposing = input.windDirection !== undefined && ((input.currentDirection === "ebb" && input.windDirection >= 135 && input.windDirection <= 225) || (input.currentDirection === "flood" && (input.windDirection <= 45 || input.windDirection >= 315)));
  if (opposing) wind = fromRank(rank[wind] + 1);
  const verdict = fromRank(Math.max(rank[discharge], rank[current], rank[wind]));
  return { verdict, opposingWind: opposing, factors: { discharge, current, wind } };
}
