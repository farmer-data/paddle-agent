import { beforeEach, expect, it, vi } from "vitest";
import { inputs, NOW } from "./test-fixtures";

const historyMock = vi.fn();
const seriesMock = vi.fn();
vi.mock("./sources", () => ({ fetchWindHistory: (d: string) => historyMock(d), fetchCurrentSeries: (s: string, d: string) => seriesMock(s, d) }));
import { tripSnapshot } from "./trip-snapshot";

beforeEach(() => { historyMock.mockReset(); seriesMock.mockReset(); });

it("rejects future trips and builds past snapshots from history", async () => {
  expect(await tripSnapshot("lower-hudson", "2026-10-27 09:00", "beginner", NOW, inputs())).toBeNull();
  historyMock.mockResolvedValue([{ ts: "2026-10-20 10:06", knots: 9.4, fromDeg: 180 }]);
  seriesMock.mockResolvedValue([{ ts: "2026-10-20 10:00", signed: -1.1, towardDeg: 183 }]);
  expect(await tripSnapshot("lower-hudson", "2026-10-20 10:00", "beginner", NOW, inputs()))
    .toEqual({ windKnots: 9.4, windFromDeg: 180, currentKnots: 1.1, currentPhase: "ebb", verdict: "danger" });
});

it("uses the outlook hour within an hour of now", async () => {
  const s = await tripSnapshot("lower-hudson", "2026-10-26 12:20", "experienced", NOW, inputs());
  expect(s).toEqual({ windKnots: 5, windFromDeg: 180, currentKnots: 0.6, currentPhase: "flood", verdict: "safe" });
  expect(historyMock).not.toHaveBeenCalled();
});

it("returns null when history has no record within 60 minutes or a fetch fails", async () => {
  historyMock.mockResolvedValue([{ ts: "2026-10-20 14:00", knots: 9, fromDeg: 180 }]);
  seriesMock.mockResolvedValue([{ ts: "2026-10-20 10:00", signed: -1.1, towardDeg: 183 }]);
  expect(await tripSnapshot("lower-hudson", "2026-10-20 10:00", "beginner", NOW, inputs())).toBeNull();
  historyMock.mockRejectedValue(new Error("down"));
  expect(await tripSnapshot("lower-hudson", "2026-10-20 10:00", "beginner", NOW, inputs())).toBeNull();
});
