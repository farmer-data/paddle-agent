import type { HourView, ZoneOutlook } from "@/lib/outlook";
import { VERDICT_THEME } from "./verdict-card";

export function HourStrip({ strip, nowKey, selectedKey, onSelect }: {
  strip: ZoneOutlook["strip"]; nowKey: string; selectedKey: string | null; onSelect: (key: string | null) => void;
}) {
  if (strip.hours.length === 0) return null;
  return (
    <section aria-label={`${strip.label} by the hour`}>
      <div className="strip-head">
        <span className="vcard-meta">{strip.label}</span>
        <span className="vcard-meta">tap an hour</span>
      </div>
      <div className="strip">
        {strip.hours.map((h: HourView) => (
          <button key={h.key} type="button" aria-pressed={h.key === selectedKey}
            className={h.key === nowKey ? "is-now" : undefined}
            aria-label={`${h.hourLabel}: ${VERDICT_THEME[h.risk].word}`}
            style={{ "--hour-color": VERDICT_THEME[h.risk].color } as React.CSSProperties}
            onClick={() => onSelect(h.key === selectedKey ? null : h.key)} />
        ))}
      </div>
      <div className="strip-labels" aria-hidden>
        {strip.hours.map((h, i) => <span key={h.key}>{i % 3 === 0 ? h.hourLabel.replace(" ", "") : ""}</span>)}
      </div>
    </section>
  );
}
