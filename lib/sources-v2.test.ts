import { afterEach, expect, it, vi } from "vitest";
import { fetchAlerts, fetchCurrentSeries, fetchDischarge, fetchHourlyWind, fetchRain48h, fetchWaterTemp, fetchWindHistory } from "./sources";

afterEach(() => vi.restoreAllMocks());

let fetchMock: ReturnType<typeof vi.fn>;
const stub = (body: unknown, status = 200) => {
  fetchMock = vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
};
const stubSequence = (...bodies: unknown[]) => {
  let i = 0;
  fetchMock = vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify(bodies[i++]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
};

it("maps NOAA current points with per-station flow-toward heading", async () => {
  stub({ current_predictions: { cp: [{ Time: "2026-10-26 07:00", Velocity_Major: -0.91, meanEbbDir: 241, meanFloodDir: 45 }, { Time: "2026-10-26 08:00", Velocity_Major: 1.2, meanEbbDir: 241, meanFloodDir: 45 }] } });
  expect(await fetchCurrentSeries("NYH1924", "2026-10-26")).toEqual([
    { ts: "2026-10-26 07:00", signed: -0.91, towardDeg: 241 }, { ts: "2026-10-26 08:00", signed: 1.2, towardDeg: 45 }]);
  const url = String(fetchMock.mock.calls[0][0]);
  for (const q of ["station=NYH1924", "begin_date=20261026", "end_date=20261026", "interval=60"]) expect(url).toContain(q);
});
it("rejects current points with a non-finite speed or heading", async () => {
  stub({ current_predictions: { cp: [{ Time: "2026-10-26 07:00", Velocity_Major: -0.91, meanEbbDir: null, meanFloodDir: 45 }] } });
  await expect(fetchCurrentSeries("NYH1924", "2026-10-26")).rejects.toThrow();
  stub({ current_predictions: { cp: [{ Time: "2026-10-26 07:00", Velocity_Major: "x", meanEbbDir: 241, meanFloodDir: 45 }] } });
  await expect(fetchCurrentSeries("NYH1924", "2026-10-26")).rejects.toThrow();
  stub({ current_predictions: { cp: [{ Time: "2026-10-26 07:00", Velocity_Major: 1, meanEbbDir: 241 }] } });
  await expect(fetchCurrentSeries("NYH1924", "2026-10-26")).rejects.toThrow();
});
it("takes the upper number of an NWS wind range", async () => {
  stubSequence({ properties: { forecastHourly: "https://x/hourly" } },
    { properties: { generatedAt: "2026-10-26T23:50:00+00:00", updateTime: "2026-10-26T18:20:57+00:00", periods: [{ startTime: "2026-10-26T18:00:00-04:00", windSpeed: "10 to 15 mph", windDirection: "SW" }] } });
  expect(await fetchHourlyWind([-73.94, 40.78])).toEqual({ updatedAt: "2026-10-26T23:50:00+00:00",
    periods: [{ ts: "2026-10-26T18:00:00-04:00", windKnots: 13, fromDeg: 225, direction: "SW" }] });
  expect(String(fetchMock.mock.calls[1][0])).toBe("https://x/hourly");
  expect((fetchMock.mock.calls[0][1] as any).headers["User-Agent"]).toBe("PaddleAgent/0.2");
});
it("falls back to updateTime when generatedAt is absent", async () => {
  stubSequence({ properties: { forecastHourly: "https://x/hourly" } },
    { properties: { updateTime: "2026-10-26T18:20:57+00:00", periods: [] } });
  expect((await fetchHourlyWind([-73.94, 40.78])).updatedAt).toBe("2026-10-26T18:20:57+00:00");
});
it("rejects USGS missing-data sentinels", async () => {
  stub({ value: { timeSeries: [{ values: [{ value: [{ value: "-999999", dateTime: "a" }] }] }] } });
  await expect(fetchDischarge()).rejects.toThrow();
});
it("sums the last 48 hours of rain up to the current NY hour", async () => {
  const time = Array.from({ length: 72 }, (_, i) => `2026-10-${String(24 + Math.floor(i / 24)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00`);
  stub({ hourly: { time, precipitation: time.map((t) => (t === "2026-10-24T05:00" ? 9 : 0.01)) } });
  expect(await fetchRain48h(new Date("2026-10-26T22:30:00Z"))).toBeCloseTo(0.48, 2); // 18:30 NY: window 10-24 19:00 … 10-26 18:00
});
it("throws on HTTP errors and on missing data", async () => {
  stub({}, 500); await expect(fetchDischarge()).rejects.toThrow();
  stub({ error: { message: "No data was found" } }); await expect(fetchWaterTemp()).rejects.toThrow();
});
it("returns alert events with end times", async () => {
  stub({ features: [{ properties: { event: "Small Craft Advisory", ends: "2026-10-27T18:00:00-04:00", expires: "x" } }] });
  expect(await fetchAlerts([-74, 40.7])).toEqual([{ event: "Small Craft Advisory", endsAt: "2026-10-27T18:00:00-04:00" }]);
});
it("reads the last USGS discharge value and the latest water temperature", async () => {
  stub({ value: { timeSeries: [{ values: [{ value: [{ value: "1000", dateTime: "a" }, { value: "1234", dateTime: "b" }] }] }] } });
  expect(await fetchDischarge()).toEqual({ cfs: 1234, at: "b" });
  stub({ data: [{ t: "2026-10-26 18:00", v: "61.3" }] });
  expect(await fetchWaterTemp()).toEqual({ f: 61.3, at: "2026-10-26 18:00" });
});
it("maps NOAA wind history", async () => {
  stub({ data: [{ t: "2026-10-26 18:00", s: "8.5", d: "225" }] });
  expect(await fetchWindHistory("2026-10-26")).toEqual([{ ts: "2026-10-26 18:00", knots: 8.5, fromDeg: 225 }]);
  expect(String(fetchMock.mock.calls[0][0])).toContain("begin_date=20261026");
});
