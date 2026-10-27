import type { Mode } from "@/lib/config";
import { ZONES, type ZoneId } from "@/lib/zones";

const NEAR = "near";

export function TopBar({ mode, onMode, zoneId, onZone, onNear, updatedMinAgo, note }: {
  mode: Mode; onMode: (m: Mode) => void; zoneId: ZoneId; onZone: (z: ZoneId) => void; onNear: () => void;
  updatedMinAgo: number | null; note: string | null;
}) {
  return (
    <header className="topbar">
      <h1 className="brand">Paddle <em>Agent</em></h1>
      <div className="mode-switch" role="group" aria-label="Experience level">
        <button type="button" aria-pressed={mode === "beginner"} onClick={() => onMode("beginner")}>Beginner</button>
        <button type="button" aria-pressed={mode === "experienced"} onClick={() => onMode("experienced")}>Experienced</button>
      </div>
      <div className="topbar-row">
        <select className="zone-pick" aria-label="Zone" value={zoneId}
          onChange={(e) => (e.target.value === NEAR ? onNear() : onZone(e.target.value as ZoneId))}>
          {ZONES.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          <option value={NEAR}>📍 Near me</option>
        </select>
        <span className="fresh" aria-live="polite">
          {note ?? (updatedMinAgo === null ? "" : updatedMinAgo < 1 ? "Updated just now" : `Updated ${updatedMinAgo} min ago`)}
        </span>
      </div>
    </header>
  );
}
