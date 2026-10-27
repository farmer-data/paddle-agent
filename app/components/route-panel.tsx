"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Mode } from "@/lib/config";
import type { ZoneOutlook } from "@/lib/outlook";
import { planRoute, type RoutePlan, type RouteRequest } from "@/lib/route/plan";
import { nyStamp, wallMinutes } from "@/lib/time";
import { PLACES, type ZoneId } from "@/lib/zones";
import { clock, VERDICT_THEME } from "./verdict-card";

const LAUNCHES = PLACES.filter((p) => p.kind === "launch");
const LANDMARKS = PLACES.filter((p) => p.kind === "landmark");
const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);
const isBlockMessage = (w: string) => w.toLowerCase().includes("not for first-season");

export function RoutePanel({ outlooks, mode, initialFrom, initialTo, initial, onPlan }: {
  outlooks: Record<ZoneId, ZoneOutlook>; mode: Mode; initialFrom?: string; initialTo?: string;
  // Restores a whole earlier request (a chat-planned route). Only read when the panel mounts.
  initial?: RouteRequest | null; onPlan: (p: RoutePlan | null) => void;
}) {
  const [open, setOpen] = useState(!!(initialFrom || initialTo || initial));
  const [from, setFrom] = useState(initial?.fromId ?? initialFrom ?? "");
  const [to, setTo] = useState(initial?.toId ?? initialTo ?? "");
  const [depart, setDepart] = useState(initial?.depart ?? "");
  const [outAndBack, setOutAndBack] = useState(!!initial?.outAndBack);
  const [turnaround, setTurnaround] = useState(initial?.turnaround ?? "");
  const onPlanRef = useRef(onPlan);
  useEffect(() => { onPlanRef.current = onPlan; });

  // Every :00 and :30 in the 48 h outlook that is not already past.
  const now = nyStamp(new Date());
  const nowMin = wallMinutes(now);
  const options = useMemo(() => {
    const hours = Object.values(outlooks)[0]?.hours ?? [];
    return hours.flatMap((h) => [`${h.key}:00`, `${h.key}:30`]).filter((s) => wallMinutes(s) >= nowMin);
    // The list only needs rebuilding when the half-hour or the outlook changes.
  }, [outlooks, Math.floor(nowMin / 30)]); // eslint-disable-line react-hooks/exhaustive-deps
  const defaultDepart = options.find((s) => s.endsWith(":00")) ?? options[0] ?? "";
  const effDepart = depart || defaultDepart;
  const departList = !effDepart || options.includes(effDepart) ? options : [effDepart, ...options];
  const turnList = departList.filter((s) => wallMinutes(s) > wallMinutes(effDepart));
  const dayWord = (s: string) => (s.slice(0, 10) === now.slice(0, 10) ? "" : "Tomorrow ");

  const { plan, error } = useMemo<{ plan: RoutePlan | null; error: string | null }>(() => {
    if (!from || !to || !effDepart) return { plan: null, error: null };
    try {
      const req: RouteRequest = { fromId: from, toId: to, depart: effDepart, outAndBack, turnaround: outAndBack && turnaround ? turnaround : undefined };
      return { plan: planRoute(req, outlooks, mode, new Date()), error: null };
    } catch (e) {
      return { plan: null, error: e instanceof Error ? e.message : "Could not plan that route" };
    }
  }, [from, to, effDepart, outAndBack, turnaround, outlooks, mode]);

  useEffect(() => { onPlanRef.current(plan); }, [plan]);

  const theme = plan ? VERDICT_THEME[plan.worst] : null;
  const block = plan?.blocked ? (plan.warnings.find(isBlockMessage) ?? "Not for first-season paddlers") : null;
  return (
    <div className="route-panel">
      <button type="button" className="route-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <strong>Plan a route</strong>
        <span>{plan ? `${plan.fromName.split(" (")[0]} → ${plan.toName.split(" (")[0]}` : open ? "Hide" : "Launch to launch, with timing"}</span>
      </button>
      {open && (
        <div className="route-body">
          <div className="route-grid">
            <label>From
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Choose a launch</option>
                {LAUNCHES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>To
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a destination</option>
                <optgroup label="Launches">{LAUNCHES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
                <optgroup label="Landmarks">{LANDMARKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
              </select>
            </label>
            <label>Depart
              <select value={effDepart} onChange={(e) => setDepart(e.target.value)}>
                {departList.map((s) => <option key={s} value={s}>{dayWord(s)}{clock(s)}</option>)}
              </select>
            </label>
          </div>
          <label className="route-check">
            <input type="checkbox" checked={outAndBack} onChange={(e) => setOutAndBack(e.target.checked)} /> Out and back
          </label>
          {outAndBack && (
            <label>Turn around
              <select value={turnaround} onChange={(e) => setTurnaround(e.target.value)}>
                <option value="">Straight back</option>
                {turnList.map((s) => <option key={s} value={s}>{dayWord(s)}{clock(s)}</option>)}
              </select>
            </label>
          )}
          {error && <p className="route-error" role="alert">{error}</p>}
          {!plan && !error && <p className="route-hint">Pick a start and a destination.</p>}
          {plan && theme && (
            <div className="route-result" style={{ "--risk-color": theme.color } as React.CSSProperties}>
              <p className="route-summary">
                <strong>{plan.distanceNm.toFixed(1)} nm</strong> · {duration(plan.durationMin)} · arrive {clock(plan.eta)}
                <span className="route-verdict">{theme.emoji} {theme.word}</span>
              </p>
              {block && <p className="route-blocked"><strong>{block}</strong></p>}
              {plan.warnings.filter((w) => !block || !isBlockMessage(w)).length > 0 && (
                <ul className="route-warnings">
                  {plan.warnings.filter((w) => !block || !isBlockMessage(w)).map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
              {plan.suggestion && plan.suggestion.depart !== effDepart && (
                <p className="route-suggest">
                  <span>Leave {clock(plan.suggestion.depart)} — {duration(plan.suggestion.durationMin)}{plan.suggestion.allGreen ? ", all 🟢" : ""}</span>
                  <button type="button" onClick={() => setDepart(plan.suggestion!.depart)}>Use this time</button>
                </p>
              )}
              <p className="route-caveat">{plan.caveat}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
