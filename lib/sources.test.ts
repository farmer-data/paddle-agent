import { afterEach, expect, it, vi } from "vitest";
import { fetchCurrentNow, fetchCurrentPredictions } from "./sources";

afterEach(() => vi.restoreAllMocks());

it("maps signed Velocity_Major to ebb/flood magnitude", async () => {
  const payload = {
    current_predictions: {
      cp: [
        { Time: "2026-07-26 07:00", Velocity_Major: 0.48, Bin: "13" },
        { Time: "2026-07-26 11:00", Velocity_Major: -0.91, Bin: "13" },
        { Time: "2026-07-26 04:00", Velocity_Major: 0, Bin: "13" },
      ],
    },
  };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

  const rows = await fetchCurrentPredictions("2026-07-26");

  expect(rows).toEqual([
    { ts: "2026-07-26 07:00", knots: 0.48, direction: "flood" },
    { ts: "2026-07-26 11:00", knots: 0.91, direction: "ebb" },
    { ts: "2026-07-26 04:00", knots: 0, direction: "flood" },
  ]);
});

it("requests the NYH1927 station with a compact date range and interval=60", async () => {
  const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({ current_predictions: { cp: [] } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await fetchCurrentPredictions("2026-07-26");

  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain("product=currents_predictions");
  expect(url).toContain("station=NYH1927");
  expect(url).toContain("begin_date=20260726");
  expect(url).toContain("end_date=20260726");
  expect(url).toContain("interval=60");
});

it("returns [] when the payload has no cp array", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 200 })));
  expect(await fetchCurrentPredictions("2026-07-26")).toEqual([]);
});

it("fetchCurrentNow picks the 6-minute prediction nearest to now and emits speed + dir readings", async () => {
  const payload = {
    current_predictions: {
      cp: [
        { Time: "2026-07-21 08:00", Velocity_Major: -1.2, meanEbbDir: 183, meanFloodDir: 11, Bin: "13" },
        { Time: "2026-07-21 08:06", Velocity_Major: -1.5, meanEbbDir: 183, meanFloodDir: 11, Bin: "13" },
        { Time: "2026-07-21 08:12", Velocity_Major: -1.8, meanEbbDir: 183, meanFloodDir: 11, Bin: "13" },
      ],
    },
  };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

  // 08:07 America/New_York → nearest row is 08:06; negative velocity → ebb heading (183°).
  const rows = await fetchCurrentNow(new Date("2026-07-21T08:07:00-04:00"));

  expect(rows).toEqual([
    { stationId: "NYH1927", source: "noaa", parameter: "current_speed", ts: "2026-07-21 08:06", value: 1.5 },
    { stationId: "NYH1927", source: "noaa", parameter: "current_dir", ts: "2026-07-21 08:06", value: 183 },
  ]);
});

it("fetchCurrentNow uses the flood heading when the current is flooding", async () => {
  const payload = {
    current_predictions: {
      cp: [{ Time: "2026-07-21 08:06", Velocity_Major: 0.9, meanEbbDir: 183, meanFloodDir: 11, Bin: "13" }],
    },
  };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

  const rows = await fetchCurrentNow(new Date("2026-07-21T08:07:00-04:00"));
  expect(rows).toContainEqual({ stationId: "NYH1927", source: "noaa", parameter: "current_dir", ts: "2026-07-21 08:06", value: 11 });
  expect(rows.find((r) => r.parameter === "current_speed")?.value).toBe(0.9);
});

it("fetchCurrentNow requests NYH1927 at interval=6 and returns [] on an empty payload", async () => {
  const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({ current_predictions: { cp: [] } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const rows = await fetchCurrentNow(new Date("2026-07-21T08:07:00-04:00"));

  expect(rows).toEqual([]);
  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain("station=NYH1927");
  expect(url).toContain("interval=6");
  expect(url).toContain("begin_date=20260721");
});
