import type { HourView, ZoneOutlook } from "@/lib/outlook";
import { bestWindowText } from "@/lib/outlook";
import type { Verdict } from "@/lib/verdict";

export const VERDICT_THEME: Record<Verdict, { color: string; text?: string; emoji: string; word: string }> = {
  safe: { color: "var(--go)", emoji: "🟢", word: "GO" },
  caution: { color: "var(--caution)", emoji: "🟡", word: "CAUTION" },
  danger: { color: "var(--nogo)", emoji: "🔴", word: "NO-GO" },
  unknown: { color: "#c9d3d9", text: "var(--muted)", emoji: "⚪", word: "No verdict" },
};

const clock = (stamp: string) => {
  const h = Number(stamp.slice(11, 13));
  return `${h % 12 === 0 ? 12 : h % 12}:${stamp.slice(14, 16)} ${h < 12 ? "AM" : "PM"}`;
};

export function VerdictCard({ outlook, hour, isNow, failed, onRetry }: {
  outlook: ZoneOutlook | null; hour: HourView | null; isNow: boolean; failed: boolean; onRetry: () => void;
}) {
  if (!outlook || !hour) {
    return (
      <section className="vcard" aria-busy={!failed} aria-label="Verdict">
        {failed ? (
          <p className="vcard-error">Couldn&apos;t load conditions.<button type="button" onClick={onRetry}>Try again</button></p>
        ) : (
          <>
            <span className="sk sk-word" />
            <span className="sk sk-line" />
            <span className="sk sk-line short" />
          </>
        )}
      </section>
    );
  }
  const theme = VERDICT_THEME[hour.risk];
  const lines = hour.risk === "unknown" && outlook.unavailable.length ? outlook.unavailable : hour.reasons.slice(0, 2);
  const best = bestWindowText(outlook.best, outlook.strip.label);
  return (
    <section className="vcard" style={{ "--verdict-color": theme.color, "--verdict-text": theme.text ?? theme.color } as React.CSSProperties} aria-label="Verdict">
      <div className="vcard-meta">{outlook.zoneName} · {isNow ? "Now" : hour.hourLabel}</div>
      <h2 className="vcard-word">{theme.emoji} {theme.word}</h2>
      {lines.length > 0 && <ul className="vcard-reasons">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      <p className="vcard-best">{best.primary}{best.secondary && <span>{best.secondary}</span>}</p>
      {outlook.gear && <p className="vcard-gear">{outlook.gear}</p>}
    </section>
  );
}

export function FactorChips({ outlook, hour, isNow, rainKnown }: { outlook: ZoneOutlook; hour: HourView; isNow: boolean; rainKnown: boolean }) {
  const wind = hour.windKnots === null ? "unavailable" : `${hour.windKnots} kn${hour.direction ? ` ${hour.direction}` : ""}`;
  const cur = hour.current === null ? "unavailable"
    : `${Math.abs(hour.current).toFixed(1)} kn ${hour.current < 0 ? "ebb" : "flood"}`;
  const turn = isNow ? outlook.currentNow?.summary.nextTurn : null;
  return (
    <div className="factors">
      <span className="fchip">💨 {wind}</span>
      <span className="fchip">🌊 {cur}{turn && ` · turns ${turn.toPhase} ${turn.atLabel}`}</span>
      <span className="fchip">🌡 {outlook.waterTempF === null ? "unavailable" : `${Math.round(outlook.waterTempF)} °F`}</span>
      {outlook.rainBadge ? <span className="fchip warn">💧 {outlook.rainBadge}</span>
        : <span className="fchip">💧 {rainKnown ? "No recent rain" : "Rain data unavailable"}</span>}
      <span className="fchip">🌅 {clock(outlook.sun.sunset)}</span>
    </div>
  );
}
