import type { CurrentPrediction } from "./sources";
import { assessSafety, type Risk } from "./safety";
import type { TargetWindow } from "./when";

export type HourlyRisk = { ts: string; hourLabel: string; windKnots: number; direction: string; risk: Risk; opposing: boolean };
export type PaddleWindow = { startLabel: string; endLabel: string; startIndex: number; endIndex: number; risk: Risk };

const rank: Record<Risk, number> = { safe: 0, caution: 1, danger: 2 };
const directionDegrees: Record<string, number> = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };

// Both NWS ("2026-07-26T06:00:00-04:00") and NOAA ("2026-07-26 06:00") express Eastern
// time, so slice a "YYYY-MM-DD HH" key from the string rather than doing TZ math.
const hourKey = (ts: string) => ts.slice(0, 13).replace("T", " ");
const dateOf = (ts: string) => ts.slice(0, 10);
const hourOf = (ts: string) => Number(ts.slice(11, 13));
const labelForHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

export function buildHourlyOutlook(
  wind: { ts: string; windKnots: number; direction: string }[],
  current: CurrentPrediction[],
  base: { dischargeCfs?: number },
  target: TargetWindow,
): HourlyRisk[] {
  const currentByHour = new Map(current.map((c) => [hourKey(c.ts), c]));
  const selected = target.isNow
    ? wind.slice(0, 12)
    : wind.filter((w) => dateOf(w.ts) === target.date && hourOf(w.ts) >= target.startHour && hourOf(w.ts) < target.endHour);

  return selected.map((period) => {
    const cur = currentByHour.get(hourKey(period.ts));
    const assessment = assessSafety({
      dischargeCfs: base.dischargeCfs,
      currentKnots: cur?.knots,
      windKnots: period.windKnots,
      windDirection: directionDegrees[period.direction],
      currentDirection: cur?.direction ?? "ebb",
    });
    return {
      ts: period.ts,
      hourLabel: labelForHour(hourOf(period.ts)),
      windKnots: period.windKnots,
      direction: period.direction,
      risk: assessment.verdict,
      opposing: assessment.opposingWind,
    };
  });
}

// Longest stretch of all-safe hours; if none, longest stretch avoiding danger.
export function findBestWindow(outlook: HourlyRisk[]): PaddleWindow | null {
  for (const ceiling of [rank.safe, rank.caution]) {
    let best: [number, number] | null = null;
    let start = -1;
    for (let i = 0; i <= outlook.length; i++) {
      if (i < outlook.length && rank[outlook[i].risk] <= ceiling) {
        if (start === -1) start = i;
      } else if (start !== -1) {
        if (!best || i - start > best[1] - best[0]) best = [start, i - 1];
        start = -1;
      }
    }
    if (best && best[1] > best[0]) {
      const [from, to] = best;
      return {
        startLabel: outlook[from].hourLabel,
        endLabel: outlook[to].hourLabel,
        startIndex: from,
        endIndex: to,
        risk: ceiling === rank.safe ? "safe" : "caution",
      };
    }
  }
  return null;
}

export function assessWindow(hourly: HourlyRisk[]): { verdict: Risk; best: PaddleWindow | null; opposingWind: boolean } {
  const best = findBestWindow(hourly);
  const verdict: Risk = best ? best.risk : "danger";
  const scope = best ? hourly.slice(best.startIndex, best.endIndex + 1) : hourly;
  const opposingWind = scope.some((h) => h.opposing);
  return { verdict, best, opposingWind };
}
