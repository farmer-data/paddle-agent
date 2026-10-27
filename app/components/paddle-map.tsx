"use client";

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { HourView, ZoneOutlook } from "@/lib/outlook";
import type { RoutePlan } from "@/lib/route/plan";
import type { Trip } from "@/lib/trips";
import type { Verdict } from "@/lib/verdict";
import { PLACES, ZONES, zoneById, type LonLat, type ZoneId } from "@/lib/zones";

export type PaddleMapProps = {
  outlooks: Record<ZoneId, ZoneOutlook>; selectedKey: string; zoneId: ZoneId; trips: Trip[];
  route: RoutePlan | null;
  interactive: boolean;
  onPickZone?: (z: ZoneId) => void;
  onPlanFrom?: (placeId: string) => void;
};

maplibregl.setWorkerUrl(`${location.origin}/maplibre/maplibre-gl-worker.mjs`);

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
// Used when the tile style cannot be fetched (offline): zones still draw over a blank background.
const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8eff3" } }],
};
const NAVY = "#0d3349";
const VERDICT_COLOR: Record<Verdict, string> = { safe: "#1e9e57", caution: "#dd8a00", danger: "#e03e3e", unknown: "#c9d3d9" };
const VERDICT_WORD: Record<Verdict, string> = { safe: "GO", caution: "CAUTION", danger: "NO-GO", unknown: "No verdict" };
const ROUTE_COLOR = VERDICT_COLOR;
const RATING_COLOR = { calm: "#1e9e57", moderate: "#dd8a00", rough: "#e03e3e" };

const hourAt = (o: ZoneOutlook, key: string): HourView | undefined => o.hours.find((h) => h.key === key) ?? o.hours[0];

function bounds(): maplibregl.LngLatBounds {
  const b = new maplibregl.LngLatBounds();
  for (const z of ZONES) for (const p of z.shape) b.extend(p);
  return b;
}

function arrow(deg: number, label: string, cls: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `map-arrow ${cls}`;
  el.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 2 L19 20 L12 16 L5 20 Z" /></svg><b></b>';
  (el.firstElementChild as SVGElement).style.transform = `rotate(${deg}deg)`;
  el.lastElementChild!.textContent = label;
  return el;
}

export default function PaddleMap(props: PaddleMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const sync = useRef<() => void>(() => {});
  const { interactive } = props;

  useEffect(() => { latest.current = props; sync.current(); });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: el, style: STYLE_URL, bounds: bounds(), fitBoundsOptions: { padding: 24 },
        interactive, attributionControl: interactive ? undefined : false,
      });
    } catch {
      // No WebGL (old device, blocked GPU): say so instead of taking the page down.
      el.textContent = "Map unavailable on this device";
      el.classList.add("map-failed");
      return () => { el.textContent = ""; el.classList.remove("map-failed"); };
    }
    if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const pins: maplibregl.Marker[] = [];
    let dynamic: maplibregl.Marker[] = [];
    let ready = false;
    let fellBack = false;
    let drawnKey = "";

    const popupFor = (placeId: string): HTMLElement => {
      const p = PLACES.find((x) => x.id === placeId)!;
      const { outlooks, selectedKey, onPickZone, onPlanFrom } = latest.current;
      const hour = hourAt(outlooks[p.zoneId], selectedKey);
      const root = document.createElement("div");
      root.className = "map-popup";
      const title = document.createElement("strong"); title.textContent = p.name;
      const meta = document.createElement("span");
      meta.textContent = `${zoneById(p.zoneId).name} · ${hour ? VERDICT_WORD[hour.risk] : VERDICT_WORD.unknown}${hour ? ` · ${hour.hourLabel}` : ""}`;
      root.append(title, meta);
      if (onPickZone) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = "Set as my zone";
        b.onclick = () => onPickZone(p.zoneId);
        root.append(b);
      }
      if (onPlanFrom) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = "Plan a route from here";
        b.onclick = () => onPlanFrom(p.id);
        root.append(b);
      }
      return root;
    };

    // The 120 px preview is a colour overview only: zones, no pins or arrows.
    for (const p of interactive ? PLACES : []) {
      const pin = document.createElement("div");
      pin.className = `map-pin ${p.kind}`;
      const marker = new maplibregl.Marker({ element: pin }).setLngLat(p.lonLat).addTo(map);
      pin.title = p.name;
      if (p.kind === "launch") {
        const popup = new maplibregl.Popup({ offset: 12, closeButton: true });
        popup.on("open", () => popup.setDOMContent(popupFor(p.id)));
        marker.setPopup(popup);
      }
      pins.push(marker);
    }

    const run = () => {
      if (!ready) return;
      const { outlooks, selectedKey, zoneId, trips } = latest.current;
      const features = ZONES.map((z) => {
        const hour = hourAt(outlooks[z.id], selectedKey);
        return {
          type: "Feature" as const, properties: { id: z.id, color: VERDICT_COLOR[hour?.risk ?? "unknown"], selected: z.id === zoneId },
          geometry: { type: "Polygon" as const, coordinates: [[...z.shape, z.shape[0]]] },
        };
      });
      (map.getSource("zones") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });

      const route = latest.current.route;
      (map.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: (route?.segments ?? []).map((s) => ({
          type: "Feature" as const, properties: { color: ROUTE_COLOR[s.risk], dashed: s.kind === "crossing" },
          geometry: { type: "LineString" as const, coordinates: [s.from, s.to] },
        })),
      });
      // Frame a newly planned route once; slider and data refreshes leave the view alone.
      const key = route ? `${route.request.fromId}|${route.request.toId}|${!!route.request.outAndBack}` : "";
      if (route && key !== drawnKey) {
        const b = new maplibregl.LngLatBounds();
        for (const s of route.segments) { b.extend(s.from); b.extend(s.to); }
        if (!b.isEmpty()) map.fitBounds(b, { padding: interactive ? 60 : 16, maxZoom: 14, duration: 0 });
      }
      drawnKey = key;

      for (const m of dynamic) m.remove();
      dynamic = [];
      if (!interactive) return;
      for (const z of ZONES) {
        const h = hourAt(outlooks[z.id], selectedKey);
        if (h?.current != null && h.currentTowardDeg != null) {
          dynamic.push(new maplibregl.Marker({ element: arrow(h.currentTowardDeg, `${Math.abs(h.current).toFixed(1)} kn`, "current") }).setLngLat(z.center).addTo(map));
        }
      }
      const sel = hourAt(outlooks[zoneId], selectedKey);
      if (sel?.windKnots != null && sel.windFromDeg != null) {
        dynamic.push(new maplibregl.Marker({ element: arrow(sel.windFromDeg + 180, `wind ${Math.round(sel.windKnots)} kn`, "wind"), offset: [0, -40] }).setLngLat(zoneById(zoneId).center).addTo(map));
      }

      const seen = new Map<string, number>();
      for (const t of trips) {
        const place = t.placeId ? PLACES.find((p) => p.id === t.placeId) : undefined;
        const base: LonLat = place ? place.lonLat : zoneById(t.zoneId).center;
        const k = place ? place.id : `zone:${t.zoneId}`;
        const n = seen.get(k) ?? 0;
        seen.set(k, n + 1);
        const pin = document.createElement("div");
        pin.className = "map-trip";
        pin.style.background = RATING_COLOR[t.rating];
        pin.title = `${t.route} (${t.rating})`;
        dynamic.push(new maplibregl.Marker({ element: pin }).setLngLat([base[0] + n * 0.004, base[1] + n * 0.002]).addTo(map));
      }
    };
    sync.current = run;

    const onStyle = () => {
      if (!map.getSource("zones")) {
        map.addSource("zones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.45 } });
        map.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": NAVY, "line-width": ["case", ["get", "selected"], 2, 0] } });
      }
      if (!map.getSource("route")) {
        map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "route-solid", type: "line", source: "route", filter: ["!", ["get", "dashed"]], layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 4 } });
        map.addLayer({ id: "route-dashed", type: "line", source: "route", filter: ["get", "dashed"],
          paint: { "line-color": ["get", "color"], "line-width": 4, "line-dasharray": [1.5, 1.5] } });
      }
      ready = true;
      run();
    };
    map.on("style.load", onStyle);
    map.on("error", () => {
      if (ready || fellBack) return;
      fellBack = true;
      map.setStyle(BLANK_STYLE);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);

    return () => {
      sync.current = () => {};
      ro.disconnect();
      for (const m of [...pins, ...dynamic]) m.remove();
      map.remove();
    };
  }, [interactive]);

  return <div ref={host} className="paddle-map" />;
}
