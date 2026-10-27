"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { PaddleMapProps } from "./paddle-map";
import { VERDICT_THEME } from "./verdict-card";

export const PaddleMapLazy = dynamic(() => import("./paddle-map"), { ssr: false, loading: () => <div className="paddle-map map-loading" /> });

type Props = Omit<PaddleMapProps, "interactive" | "selectedKey"> & {
  open: boolean; onClose: () => void; selectedKey: string | null; onSelectKey: (key: string) => void;
  // Route panel (Task 14).
  children?: ReactNode;
};

// Full screen on phones, the left column on desktop (CSS decides; the parent mounts it only when visible).
export function MapSheet({ open, onClose, selectedKey, onSelectKey, children, ...map }: Props) {
  const hours = map.outlooks[map.zoneId].hours;
  const idx = Math.max(0, hours.findIndex((h) => h.key === selectedKey));
  const hour = hours[idx];
  const key = hour.key;
  const label = idx === 0 ? "Now" : hour.ts.slice(0, 10) === hours[0].ts.slice(0, 10) ? hour.hourLabel : `Tomorrow ${hour.hourLabel}`;
  return (
    <section className={`map-sheet${open ? " is-open" : ""}`} aria-label="Map">
      <div className="map-sheet-head">
        <h2>Map</h2>
        <button type="button" className="sheet-close" onClick={onClose}>Close</button>
      </div>
      <div className="map-sheet-body">
        <PaddleMapLazy {...map} selectedKey={key} interactive />
      </div>
      <div className="map-slider" style={{ "--hour-color": VERDICT_THEME[hour.risk].color } as React.CSSProperties}>
        <label htmlFor="map-hour">
          <strong>{label}</strong>
          <span>{VERDICT_THEME[hour.risk].word} in {map.outlooks[map.zoneId].zoneName}</span>
        </label>
        <input id="map-hour" type="range" min={0} max={hours.length - 1} step={1} value={idx}
          onChange={(e) => onSelectKey(hours[Number(e.target.value)].key)} />
      </div>
      {children}
    </section>
  );
}
