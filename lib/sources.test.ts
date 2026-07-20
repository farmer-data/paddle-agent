import { afterEach, expect, it, vi } from "vitest";
import { fetchCurrentPredictions } from "./sources";

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
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ current_predictions: { cp: [] } }), { status: 200 }));
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
