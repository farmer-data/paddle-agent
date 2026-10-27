"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Mode } from "@/lib/config";
import { buildZoneOutlook, type OutlookInputs, type ZoneOutlook } from "@/lib/outlook";
import type { RoutePlan } from "@/lib/route/plan";
import { deleteTrip, loadPref, loadTrips, MODE_KEY, saveTrip, savePref, ZONE_KEY, type Trip } from "@/lib/trips";
import { DEFAULT_ZONE, isZoneId, nearestZone, PLACES, ZONES, type ZoneId } from "@/lib/zones";
import { ChatSheet } from "./chat-sheet";
import { HourStrip } from "./hour-strip";
import { MapSheet, PaddleMapLazy } from "./map-sheet";
import { RoutePanel } from "./route-panel";
import { TopBar } from "./top-bar";
import { TripsSheet } from "./trips-sheet";
import { FactorChips, VerdictCard } from "./verdict-card";

type Sheet = "chat" | "map" | "trips" | null;
const REFRESH_MS = 10 * 60_000;
const isMode = (x: unknown): x is Mode => x === "beginner" || x === "experienced";
const isOutlookInputs = (x: unknown): x is OutlookInputs =>
  !!x && typeof x === "object" && Array.isArray((x as OutlookInputs).zones) && typeof (x as OutlookInputs).generatedAt === "string";

export function Home() {
  const [mode, setMode] = useState<Mode>("beginner");
  const [zoneId, setZoneId] = useState<ZoneId>(DEFAULT_ZONE);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [inputs, setInputs] = useState<OutlookInputs | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [activeRoute, setActiveRoute] = useState<RoutePlan | null>(null);
  // Remounts the route panel (key) when something outside it sets the route: the chat, a map popup or a ?from=&to= link.
  const [seed, setSeed] = useState<{ from?: string; to?: string; n: number }>({ n: 0 });
  const [minute, setMinute] = useState(0);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const lastFetch = useRef(0);

  // Browser-only state is read after mount so server and client markup agree.
  useEffect(() => {
    setMode(loadPref(MODE_KEY, isMode, "beginner"));
    setZoneId(loadPref(ZONE_KEY, isZoneId, DEFAULT_ZONE));
    setTrips(loadTrips());
    // Deep link: /?from=pier-40&to=intrepid opens the planner with both filled in.
    const q = new URLSearchParams(location.search);
    const known = (id: string | null) => (id && PLACES.some((p) => p.id === id) ? id : undefined);
    const from = known(q.get("from")), to = known(q.get("to"));
    if (from || to) { setSeed({ from, to, n: 1 }); setSheet("map"); }
  }, []);

  useEffect(() => {
    const tick = () => setMinute(Math.floor(Date.now() / 60_000) * 60_000);
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const load = useCallback(async () => {
    lastFetch.current = Date.now();
    try {
      const res = await fetch("/api/outlook", { cache: "no-store" });
      const data: unknown = res.ok ? await res.json() : null;
      if (!isOutlookInputs(data)) throw new Error("bad outlook");
      setInputs(data);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshIfVisible = () => { if (document.visibilityState === "visible") void load(); };
    const id = setInterval(refreshIfVisible, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - lastFetch.current >= REFRESH_MS) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  // All six zones, for the map; the home card shows the selected one.
  const outlooks = useMemo(
    () => (inputs && minute ? (Object.fromEntries(ZONES.map((z) => [z.id, buildZoneOutlook(inputs, z.id, mode, new Date(minute))])) as Record<ZoneId, ZoneOutlook>) : null),
    [inputs, mode, minute],
  );
  const outlook = outlooks ? outlooks[zoneId] : null;
  const hour = outlook ? (outlook.hours.find((h) => h.key === selectedKey) ?? outlook.hours[0]) : null;
  const isNow = !!outlook && hour === outlook.hours[0];
  const updatedMinAgo = inputs && minute ? Math.max(0, Math.round((minute - Date.parse(inputs.generatedAt)) / 60_000)) : null;

  const changeMode = (m: Mode) => { setMode(m); savePref(MODE_KEY, m); };
  const changeZone = (z: ZoneId, keepHour = false) => { setZoneId(z); if (!keepHour) setSelectedKey(null); if (noteTimer.current) clearTimeout(noteTimer.current); setLocNote(null); savePref(ZONE_KEY, z); };
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);
  const flashNote = (text: string) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setLocNote(text);
    noteTimer.current = setTimeout(() => setLocNote(null), 5000);
  };
  const nearMe = () => {
    if (!navigator.geolocation) { flashNote("Location unavailable"); return; }
    flashNote("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => changeZone(nearestZone([pos.coords.longitude, pos.coords.latitude])),
      () => flashNote("Location unavailable"),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const onTrip = useCallback((t: Trip) => {
    saveTrip(t);
    setTrips((prev) => [...prev.filter((x) => x.tripId !== t.tripId), t].slice(-50));
  }, []);
  const onDelete = (id: string) => { deleteTrip(id); setTrips((prev) => prev.filter((t) => t.tripId !== id)); };
  const closeSheet = useCallback(() => setSheet(null), []);
  // The chat planned a route: show it. On a phone the map sheet replaces the chat sheet; on desktop both stay visible.
  const showRoute = useCallback((plan: RoutePlan) => {
    setActiveRoute(plan);
    setSeed((s) => ({ n: s.n + 1 }));
    if (!window.matchMedia("(min-width: 900px)").matches) setSheet("map");
  }, []);
  const planFrom = useCallback((placeId: string) => {
    setActiveRoute(null);
    setSeed((s) => ({ from: placeId, n: s.n + 1 }));
  }, []);
  const routePanel = outlooks && (
    <RoutePanel key={seed.n} outlooks={outlooks} mode={mode} initialFrom={seed.from} initialTo={seed.to} initial={activeRoute?.request ?? null} onPlan={setActiveRoute} />
  );

  return (
    <main className="home">
      <div className="home-grid">
        <div className="home-top">
          <TopBar mode={mode} onMode={changeMode} zoneId={zoneId} onZone={changeZone} onNear={nearMe} updatedMinAgo={updatedMinAgo} note={locNote} />
        </div>
        {outlooks && wide && (
          <div className="home-map">
            <MapSheet open outlooks={outlooks} zoneId={zoneId} selectedKey={selectedKey} onSelectKey={setSelectedKey} trips={trips} route={activeRoute}
              onPickZone={(z) => changeZone(z, true)} onPlanFrom={planFrom} onClose={closeSheet}>{routePanel}</MapSheet>
          </div>
        )}
        {!wide && (
          <button type="button" className="map-slot home-map" onClick={() => setSheet("map")} aria-label="Open map">
            {outlooks && sheet !== "map" && (
              <PaddleMapLazy outlooks={outlooks} zoneId={zoneId} selectedKey={hour?.key ?? ""} trips={trips} route={activeRoute} interactive={false} />
            )}
            <span>🗺 Open map{activeRoute ? " · route planned" : ""}</span>
          </button>
        )}
        <div className="home-right">
          {outlook && outlook.alerts.length > 0 && (
            <div className="alert-banner home-alert" role="alert">
              <strong>Active warnings</strong>
              <ul>{outlook.alerts.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          )}
          <div className="home-verdict">
            <VerdictCard outlook={outlook} hour={hour} isNow={isNow} failed={loadFailed && !inputs} onRetry={() => void load()} />
          </div>
          {outlook && hour && (
            <>
              <div className="home-strip"><HourStrip strip={outlook.strip} nowKey={outlook.hours[0].key} selectedKey={selectedKey} onSelect={setSelectedKey} /></div>
              <div className="home-chips"><FactorChips outlook={outlook} hour={hour} isNow={isNow} rainKnown={inputs?.rain48hIn != null} /></div>
            </>
          )}
          <div className="home-chat">
            <ChatSheet open={sheet === "chat" || wide} onClose={closeSheet} zoneId={zoneId} mode={mode} trips={trips} onTrip={onTrip} onRoute={showRoute} />
          </div>
        </div>
      </div>

      <section className="below">
        <p className="verse">&ldquo;The tide rises, the tide falls,<br />the twilight darkens, the curlew calls.&rdquo;<span className="cite">— Henry Wadsworth Longfellow</span></p>
        <aside className="launch-note">
          <span className="launch-glyph" aria-hidden>🛶</span>
          <p>
            Ready to paddle for real?{" "}
            <a href="https://sites.google.com/hobokencoveboathouse.org/hccb/home" target="_blank" rel="noreferrer">Hoboken Cove Community Boathouse</a>{" "}
            runs New Jersey&apos;s largest <em>free</em> paddling program — kayaks, paddleboards, and outrigger canoes on the Hoboken waterfront. All volunteer-run, no experience needed.
          </p>
        </aside>
        <footer className="colophon">
          <span>USGS + NOAA + NWS</span><span className="flow-arrow">→</span>
          <span>your browser</span><span className="flow-arrow">→</span>
          <span>Qwen guide</span>
        </footer>
      </section>

      <nav className="dock" aria-label="Guide and trips">
        <button type="button" className="ask-bar" onClick={() => setSheet("chat")}>💬 Ask the guide…</button>
        <button type="button" className="trips-btn" onClick={() => setSheet("trips")}>My trips{trips.length ? ` (${trips.length})` : ""}</button>
      </nav>
      {outlooks && !wide && sheet === "map" && (
        <MapSheet open outlooks={outlooks} zoneId={zoneId} selectedKey={selectedKey} onSelectKey={setSelectedKey} trips={trips} route={activeRoute}
          onPickZone={(z) => { changeZone(z, true); closeSheet(); }} onPlanFrom={planFrom} onClose={closeSheet}>{routePanel}</MapSheet>
      )}
      <TripsSheet open={sheet === "trips"} onClose={closeSheet} trips={trips} onDelete={onDelete} />
    </main>
  );
}
