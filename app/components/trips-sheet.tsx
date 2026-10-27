import type { Trip } from "@/lib/trips";
import { cardinal } from "@/lib/verdict";

const RATING = { calm: { color: "var(--go)", word: "CALM" }, moderate: { color: "var(--caution)", word: "MODERATE" }, rough: { color: "var(--nogo)", word: "ROUGH" } };

export function TripsSheet({ open, onClose, trips, onDelete }: { open: boolean; onClose: () => void; trips: Trip[]; onDelete: (id: string) => void }) {
  if (!open) return null;
  const sorted = [...trips].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="My trips" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>My trips</h2>
          <button type="button" className="sheet-close" onClick={onClose}>Close</button>
        </div>
        {sorted.length === 0 ? (
          <p className="empty-trips">No trips yet. Tell the guide about a paddle and it will show up here.</p>
        ) : (
          <ul className="trip-list">
            {sorted.map((t) => {
              const r = RATING[t.rating];
              const s = t.snapshot;
              return (
                <li key={t.tripId} className="trip-item" style={{ "--risk-color": r.color } as React.CSSProperties}>
                  <div className="trip-head"><span className="trip-badge">{t.startedAt.slice(0, 16).replace("T", " ")}</span><span className="trip-rating">{r.word}</span></div>
                  <p className="trip-route">{t.route}</p>
                  {s && (
                    <div className="trip-meta">
                      <span>Wind {Math.round(s.windKnots)} kn{s.windFromDeg !== null && ` ${cardinal(s.windFromDeg)}`}</span>
                      <span>Current {s.currentKnots.toFixed(1)} kn {s.currentPhase}</span>
                    </div>
                  )}
                  {t.notes && <p className="trip-notes">“{t.notes}”</p>}
                  <button type="button" className="trip-del" onClick={() => onDelete(t.tripId)}>Delete</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
