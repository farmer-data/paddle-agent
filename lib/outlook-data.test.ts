import { beforeEach, describe, expect, it, vi } from "vitest";

const windMock = vi.fn();
const currentSeriesMock = vi.fn();
const alertsMock = vi.fn();
const dischargeMock = vi.fn();
const waterMock = vi.fn();
const rainMock = vi.fn();

vi.mock("./sources", () => ({
  fetchHourlyWind: (...a: unknown[]) => windMock(...a),
  fetchCurrentSeries: (...a: unknown[]) => currentSeriesMock(...a),
  fetchAlerts: (...a: unknown[]) => alertsMock(...a),
  fetchDischarge: (...a: unknown[]) => dischargeMock(...a),
  fetchWaterTemp: (...a: unknown[]) => waterMock(...a),
  fetchRain48h: (...a: unknown[]) => rainMock(...a),
}));

import { getOutlookInputs } from "./outlook-data";
import { zoneById } from "./zones";

const series = () => [{ ts: "2026-10-26 12:00", signed: 1, towardDeg: 10 }];

beforeEach(() => {
  vi.clearAllMocks();
  currentSeriesMock.mockImplementation(async () => series());
  windMock.mockResolvedValue({ periods: [], updatedAt: "2026-10-26T18:00:00Z" });
  alertsMock.mockResolvedValue([]);
  dischargeMock.mockResolvedValue({ cfs: 1, at: "2026-10-26T16:00:00Z" });
  waterMock.mockResolvedValue({ f: 60, at: "2026-10-26T16:00:00Z" });
  rainMock.mockResolvedValue(0);
});

describe("getOutlookInputs", () => {
  it("isolates failures to the zone and source that failed", async () => {
    currentSeriesMock.mockImplementation(async (station: string) => { if (station === "NYH1924") throw new Error("down"); return series(); });
    dischargeMock.mockRejectedValue(new Error("usgs down"));
    const inputs = await getOutlookInputs(new Date("2026-10-26T16:00:00Z"));
    expect(inputs.zones.find((z) => z.zoneId === "hell-gate")!.current).toBeNull();
    expect(inputs.zones.find((z) => z.zoneId === "lower-hudson")!.current).not.toBeNull();
    expect(inputs.discharge).toBeNull();
    expect(currentSeriesMock).toHaveBeenCalledWith("NYH1927", "2026-10-28");
  });
  it("fetches the forecast for each zone's centre", async () => {
    await getOutlookInputs(new Date("2026-10-26T16:00:00Z"));
    expect(windMock).toHaveBeenCalledTimes(6);
    expect(windMock).toHaveBeenCalledWith(zoneById("hell-gate").center);
  });
  it("nulls the whole series when one date fails", async () => {
    currentSeriesMock.mockImplementation(async (s: string, d: string) => { if (s === "NYH1927" && d === "2026-10-27") throw new Error("x"); return series(); });
    const inputs = await getOutlookInputs(new Date("2026-10-26T16:00:00Z"));
    expect(inputs.zones.find((z) => z.zoneId === "lower-hudson")!.current).toBeNull();
    expect(inputs.zones.find((z) => z.zoneId === "hell-gate")!.current).toHaveLength(3);
  });
});
