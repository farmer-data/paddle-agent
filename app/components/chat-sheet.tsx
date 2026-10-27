"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Area, AreaChart, Bar, BarChart, Cell, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fitHistory } from "@/lib/chat-history";
import type { PaddleBriefingData, PaddleChatUIMessage, PaddleComparisonData } from "@/lib/agent/types";
import { CONFIG, type Mode } from "@/lib/config";
import type { BestWindow, CurrentNow, HourView } from "@/lib/outlook";
import type { RoutePlan } from "@/lib/route/plan";
import { toRequestTrip, type Trip } from "@/lib/trips";
import type { Verdict } from "@/lib/verdict";
import type { ZoneId } from "@/lib/zones";

const feelFor = (knots: number) =>
  knots < 4 ? "glass — barely a ripple" :
  knots < 7 ? "soft ripples, easy water" :
  knots < 10 ? "light chop building" :
  knots < 15 ? "working water — brace your stroke" : "whitecaps — stay ashore";

const prompts = [
  "Can I paddle now?",
  "Best window today",
  "Plan Pier 40 to the Intrepid",
  "How does Sunday compare with my rough trips?",
];

const verdictTheme: Record<Verdict, { color: string; word: string }> = {
  safe: { color: "var(--go)", word: "GO" },
  caution: { color: "var(--caution)", word: "CAUTION" },
  danger: { color: "var(--nogo)", word: "NO-GO" },
  unknown: { color: "#c9d3d9", word: "NO VERDICT" },
};

const clock = (stamp: string) => {
  const h = Number(stamp.slice(11, 13));
  return `${h % 12 === 0 ? 12 : h % 12}:${stamp.slice(14, 16)} ${h < 12 ? "AM" : "PM"}`;
};

// ---- agent reply parsing --------------------------------------------------
type ParsedReply = { verdict: Verdict | null; headline: string; sections: { label: string; lines: string[] }[]; raw: string };
const sectionPattern = /^(WHY IT MATTERS|BEST MOVE|GUIDE'S NOTE|NEXT ACTION)\b[\s:→\-—–]*(.*)$/;

function parseReply(text: string): ParsedReply {
  const parsed: ParsedReply = { verdict: null, headline: "", sections: [], raw: text };
  let current: { label: string; lines: string[] } | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const section = line.match(sectionPattern);
    if (section) {
      current = { label: section[1], lines: section[2] ? [section[2].trim()] : [] };
      parsed.sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push(line.replace(/^[•·*\-—–]\s*/, ""));
      continue;
    }
    if (!parsed.verdict && /🟢|🟡|🔴|\bGO\b|\bCAUTION\b|\bNO-GO\b/.test(line)) {
      parsed.verdict = /🔴|NO-GO/.test(line) ? "danger" : /🟡|CAUTION/.test(line) ? "caution" : "safe";
      const headline = line.replace(/[🟢🟡🔴]/gu, "").replace(/^\s*(GO|CAUTION|NO-GO)\s*[—–:-]?\s*/, "").trim();
      parsed.headline = parsed.headline ? `${parsed.headline} ${headline}` : headline;
      continue;
    }
    parsed.headline = parsed.headline ? `${parsed.headline} ${line}` : line;
  }
  return parsed;
}

// ---- presentational pieces ------------------------------------------------
function PaddleTimeline({ hours, best, title }: { hours: HourView[]; best?: BestWindow | null; title?: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const picked = selected !== null ? hours[selected] : null;
  const data = hours.map((h) => ({ ...h, bar: h.windKnots ?? 0 }));
  const win = best && best.kind !== "none" ? best : null;
  const winColor = win ? (win.kind === "green" ? "var(--go)" : "var(--caution)") : undefined;
  const startLabel = win ? hours.find((h) => h.key === win.startKey)?.hourLabel : undefined;
  const endLabel = win ? hours.find((h) => h.key === win.endKey)?.hourLabel : undefined;
  return (
    <div className="timeline">
      <div className="timeline-head">
        <h4>{title ? `${title} · wind` : `Next ${hours.length} hours · wind`}</h4>
        {win && (
          <span className="window-chip" style={{ "--risk-color": winColor } as React.CSSProperties}>
            {win.kind === "green" ? "Best window" : "Least risky"} {win.startLabel}–{win.endLabel}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={132}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap="22%">
          {win && startLabel && endLabel && (
            <ReferenceArea x1={startLabel} x2={endLabel} fill={winColor} fillOpacity={0.12} stroke={winColor} strokeOpacity={0.35} strokeDasharray="3 3" />
          )}
          <ReferenceLine y={10} stroke="var(--caution)" strokeOpacity={0.4} strokeDasharray="4 4" />
          <ReferenceLine y={15} stroke="var(--nogo)" strokeOpacity={0.4} strokeDasharray="4 4" />
          <XAxis dataKey="hourLabel" tickLine={false} axisLine={false} interval={1} tick={{ fill: "var(--faint)", fontSize: 10, fontFamily: "var(--mono)" }} />
          <YAxis width={26} unit="" tickLine={false} axisLine={false} tick={{ fill: "var(--faint)", fontSize: 10, fontFamily: "var(--mono)" }} />
          <Tooltip cursor={{ fill: "rgba(27, 159, 216, 0.08)" }} contentStyle={{ background: "var(--deep)", border: "1px solid var(--line-strong)", borderRadius: 10, fontSize: 12, boxShadow: "0 10px 24px -14px rgba(13, 51, 73, 0.4)" }}
            labelStyle={{ color: "var(--muted)" }} itemStyle={{ color: "var(--text)" }}
            formatter={(value, _name, item) => {
              const hour = item?.payload as HourView | undefined;
              return hour?.risk === "unknown" ? ["No verdict", "wind"] : [`${value ?? "—"} kn ${hour?.direction ?? ""}`, "wind"];
            }} />
          <Bar dataKey="bar" radius={[3, 3, 0, 0]} isAnimationActive={false} cursor="pointer"
            onClick={(_, index) => setSelected(index === selected ? null : index)}>
            {hours.map((hour, index) => (
              <Cell key={hour.ts} fill={verdictTheme[hour.risk].color}
                fillOpacity={selected === null ? 0.85 : selected === index ? 1 : 0.35}
                stroke={selected === index ? verdictTheme[hour.risk].color : undefined} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {picked ? (
        <p className="hour-detail" style={{ "--risk-color": verdictTheme[picked.risk].color } as React.CSSProperties}>
          <strong>{picked.hourLabel}</strong> · {picked.windKnots === null ? "wind unavailable" : `${picked.windKnots} kt ${picked.direction ?? ""}`} · <span className="hour-risk">{verdictTheme[picked.risk].word}</span>{picked.windKnots !== null && <> · {feelFor(picked.windKnots)}</>}
        </p>
      ) : (
        <p className="timeline-legend">tap an hour to read the water · dashed lines = caution / no-go wind</p>
      )}
    </div>
  );
}

const EBB = "var(--cyan)";
const FLOOD = "var(--go)";

function CurrentTimeline({ hours, current, title }: { hours: HourView[]; current: CurrentNow; title?: string }) {
  const data = hours.map((h) => ({
    hourLabel: h.hourLabel,
    ebb: h.current != null && h.current < 0 ? h.current : 0,
    flood: h.current != null && h.current > 0 ? h.current : 0,
    signed: h.current,
  }));
  const max = Math.max(0.5, ...data.map((d) => Math.abs(d.signed ?? 0)));
  const { nextTurn, peakEbb, peakFlood } = current.summary;
  return (
    <div className="timeline current-timeline">
      <div className="timeline-head">
        <h4>{title ? `${title} · current` : "Current now"}</h4>
        {nextTurn && (
          <span className="window-chip" style={{ "--risk-color": nextTurn.toPhase === "ebb" ? EBB : FLOOD } as React.CSSProperties}>
            Turns {nextTurn.toPhase} {nextTurn.atLabel}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <ReferenceLine y={0} stroke="var(--line-strong)" strokeOpacity={0.7} />
          <XAxis dataKey="hourLabel" tickLine={false} axisLine={false} interval={1} tick={{ fill: "var(--faint)", fontSize: 10, fontFamily: "var(--mono)" }} />
          <YAxis width={26} domain={[-max, max]} tickLine={false} axisLine={false} tick={{ fill: "var(--faint)", fontSize: 10, fontFamily: "var(--mono)" }} tickFormatter={(v: number) => Math.abs(v).toFixed(1)} />
          <Tooltip cursor={{ stroke: "var(--line-strong)" }} contentStyle={{ background: "var(--deep)", border: "1px solid var(--line-strong)", borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: "var(--muted)" }} itemStyle={{ color: "var(--text)" }}
            formatter={(_v, _n, item) => { const s = (item?.payload as { signed: number | null } | undefined)?.signed; return [s == null ? "—" : `${Math.abs(s).toFixed(2)} kn ${s < 0 ? "ebb" : "flood"}`, "current"]; }} />
          <Area dataKey="flood" type="monotone" stroke={FLOOD} fill={FLOOD} fillOpacity={0.22} isAnimationActive={false} />
          <Area dataKey="ebb" type="monotone" stroke={EBB} fill={EBB} fillOpacity={0.22} isAnimationActive={false} />
          {data.length > 0 && (
            <ReferenceDot x={data[0].hourLabel} y={current.nowSigned} r={4} fill={current.nowSigned < 0 ? EBB : FLOOD} stroke="white" strokeWidth={1.5} />
          )}
        </AreaChart>
      </ResponsiveContainer>
      {(peakEbb || peakFlood) && (
        <p className="tide-peaks">
          {peakEbb && <span style={{ color: EBB }}>▼ ebb {peakEbb.knots.toFixed(1)} {peakEbb.atLabel}</span>}
          {peakEbb && peakFlood && <span className="tide-dot"> · </span>}
          {peakFlood && <span style={{ color: FLOOD }}>▲ flood {peakFlood.knots.toFixed(1)} {peakFlood.atLabel}</span>}
        </p>
      )}
      {current.caption && <p className="guide-note tide-quip">"{current.caption}"</p>}
    </div>
  );
}

const tripRatingTheme: Record<Trip["rating"], { color: string; word: string }> = {
  calm: { color: "var(--go)", word: "CALM" },
  moderate: { color: "var(--caution)", word: "MODERATE" },
  rough: { color: "var(--nogo)", word: "ROUGH" },
};

function TripSavedCard({ trip }: { trip: Trip }) {
  const theme = tripRatingTheme[trip.rating];
  return (
    <div className="trip-card" style={{ "--risk-color": theme.color } as React.CSSProperties}>
      <div className="trip-head">
        <span className="trip-badge">Trip logged</span>
        <span className="trip-rating">{theme.word}</span>
      </div>
      <p className="trip-route">{trip.route}</p>
      <div className="trip-meta">
        <span>{trip.startedAt}</span>
        <span className="trip-id">#{trip.tripId.slice(0, 8)}</span>
      </div>
      {trip.notes && <p className="trip-notes">“{trip.notes}”</p>}
    </div>
  );
}

function ComparisonCard({ data }: { data: PaddleComparisonData }) {
  const { forecast, rough, trips } = data;
  const theme = forecast.verdict ? verdictTheme[forecast.verdict] : undefined;
  const delta = forecast.available && rough.rough_trips > 0 ? forecast.windKnots - rough.median_wind : null;
  return (
    <div className="compare-card" style={{ "--risk-color": theme?.color ?? "var(--faint)" } as React.CSSProperties}>
      <div className="compare-head">
        <span className="compare-badge">Forecast vs rough trips</span>
        {forecast.opposingWind && <span className="compare-flag">⚠ wind against the ebb</span>}
      </div>
      <div className="compare-columns">
        <div className="compare-col">
          <span className="compare-label">{forecast.label}</span>
          <strong className="compare-value">{forecast.available ? `${forecast.windKnots.toFixed(1)} kn` : "—"}</strong>
          <em>{forecast.available ? `${forecast.windDirection} wind${forecast.currentPhase ? ` · ${forecast.currentPhase}` : ""}` : "forecast unavailable"}</em>
        </div>
        <div className="compare-vs">{delta === null ? "vs" : delta < 0 ? "↓" : "↑"}</div>
        <div className="compare-col">
          <span className="compare-label">Rough-trip median</span>
          <strong className="compare-value">{rough.rough_trips > 0 ? `${rough.median_wind.toFixed(1)} kn` : "—"}</strong>
          <em>{rough.rough_trips > 0 ? `across ${rough.rough_trips} rough trip${rough.rough_trips === 1 ? "" : "s"}` : "no rough trips logged"}</em>
        </div>
      </div>
      {trips.length > 0 && (
        <ul className="compare-trips">
          {trips.map((t) => (
            <li key={t.trip_id}>
              <span className="ct-route">{t.route}</span>
              <span className="ct-meta">{t.started_at.slice(0, 16)} · {t.wind.toFixed(1)} kn</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RouteReplyCard({ plan, onRoute }: { plan: RoutePlan; onRoute: (p: RoutePlan) => void }) {
  const theme = verdictTheme[plan.worst];
  return (
    <div className="trip-card" style={{ "--risk-color": theme.color } as React.CSSProperties}>
      <div className="trip-head">
        <span className="trip-badge">Route plan</span>
        <span className="trip-rating">{theme.word}</span>
      </div>
      <p className="trip-route">{plan.fromName} → {plan.toName}</p>
      <div className="trip-meta">
        <span>{plan.distanceNm.toFixed(1)} nm</span>
        <span>about {plan.durationMin} min</span>
        {plan.suggestion && <span>leave {clock(plan.suggestion.depart)}</span>}
      </div>
      <div className="action-row">
        <button type="button" className="action-btn" onClick={() => onRoute(plan)}>Show on map</button>
      </div>
    </div>
  );
}

function AssistantReply({ text, pending, briefing, trip, comparison, route, onRoute }: { text: string; pending?: boolean; briefing?: PaddleBriefingData | null; trip?: Trip | null; comparison?: PaddleComparisonData | null; route?: RoutePlan | null; onRoute: (p: RoutePlan) => void }) {
  const parsed = parseReply(text);
  const theme = !pending && parsed.verdict ? verdictTheme[parsed.verdict] : undefined;
  const hours = briefing?.hours;
  const hasChart = !!hours && hours.length > 0;
  const timelines = hasChart && (
    <>
      <PaddleTimeline hours={hours} best={briefing.best} title={briefing.label} />
      {briefing.currentNow && hours.some((h) => h.current != null) && <CurrentTimeline hours={hours} current={briefing.currentNow} title={briefing.label} />}
    </>
  );
  return (
    <div className={`reply${pending ? " pending" : ""}`} style={{ "--verdict-color": theme?.color } as React.CSSProperties}>
      <div className="reply-topbar">
        {theme && <span className="verdict-chip">{theme.word}</span>}
        <span>Paddle Agent briefing</span>
      </div>
      <div className="reply-body">
        {pending ? (
          <>
            <div className="reply-skeleton" aria-hidden>
              <span className="sk-line sk-head" />
              <span className="sk-line" />
              <span className="sk-line short" />
              {hasChart && <span className="sk-chart" />}
            </div>
            <div className="thinking in-body">Drafting your briefing<span className="dots"><i /><i /><i /></span></div>
          </>
        ) : (
          <>
            {trip && <TripSavedCard trip={trip} />}
            {comparison && <ComparisonCard data={comparison} />}
            {route && <RouteReplyCard plan={route} onRoute={onRoute} />}
            {parsed.headline && <p className="reply-headline">{parsed.headline}</p>}
            {parsed.sections.length > 0
              ? parsed.sections.map((section, index) => (
                  <div key={section.label} className={`reply-section${section.label === "NEXT ACTION" ? " action" : ""}${section.label === "GUIDE'S NOTE" ? " note" : ""}`} style={{ "--i": index } as React.CSSProperties}>
                    <h4>{section.label}</h4>
                    <ul>{section.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
                  </div>
                ))
              : !parsed.headline && <p className="reply-plain">{text}</p>}
            {timelines}
          </>
        )}
      </div>
    </div>
  );
}

// ---- main component -------------------------------------------------------
type Parts = PaddleChatUIMessage["parts"];

const lastData = <T extends PaddleChatUIMessage["parts"][number]["type"]>(parts: Parts, type: T) =>
  [...parts].reverse().find((part): part is Extract<Parts[number], { type: T }> => part.type === type);

export function ChatSheet({ open, onClose, zoneId, mode, trips, onTrip, onRoute, initialQuestion }: {
  open: boolean; onClose: () => void; zoneId: ZoneId; mode: Mode; trips: Trip[];
  onTrip: (t: Trip) => void; onRoute: (p: RoutePlan) => void; initialQuestion?: string | null;
}) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef<string | null>(null);
  const handlers = useRef({ onTrip, onRoute });
  handlers.current = { onTrip, onRoute };
  const transport = useMemo(() => new DefaultChatTransport<PaddleChatUIMessage>({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, messages: fitHistory(messages) } }),
  }), []);
  const { messages, sendMessage, status, error, stop } = useChat<PaddleChatUIMessage>({
    transport,
    onData: (part) => {
      if (part.type === "data-paddle-trip") handlers.current.onTrip(part.data);
      else if (part.type === "data-paddle-route") handlers.current.onRoute(part.data);
    },
  });
  const loading = status === "submitted" || status === "streaming";
  const tooLong = input.length > CONFIG.chat.maxMessageChars;

  useEffect(() => { if (messages.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, loading]);

  const ask = (question: string) => {
    if (!question.trim() || loading || question.length > CONFIG.chat.maxMessageChars) return;
    setInput("");
    void sendMessage({ text: question }, { body: { zoneId, mode, trips: trips.map(toRequestTrip) } });
  };

  useEffect(() => { if (!open) asked.current = null; }, [open]);

  useEffect(() => {
    if (open && !loading && initialQuestion && asked.current !== initialQuestion) {
      asked.current = initialQuestion;
      void sendMessage({ text: initialQuestion }, { body: { zoneId, mode, trips: trips.map(toRequestTrip) } });
    }
  }, [open, loading, initialQuestion, sendMessage, zoneId, mode, trips]);

  if (!open) return null;

  const messageText = (parts: Parts) => parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");

  return <section className="chat">
    <header className="chat-head">
      <h2>Ask the guide</h2>
      <button type="button" className="chat-close" onClick={onClose}>Close</button>
    </header>

    <div className="prompts">
      {prompts.map((prompt) => <button key={prompt} onClick={() => ask(prompt)} disabled={loading}>{prompt}</button>)}
    </div>

    <div className="messages">
      {messages.length === 0
        ? <div className="empty-state">
            <span className="empty-glyph">🛶</span>
            <p>Ask about your paddle.</p>
          </div>
        : messages.map((message) => {
            const text = messageText(message.parts);
            return <div key={message.id} className={`msg ${message.role}`}>
              {message.role === "user"
                ? <p>{text}</p>
                : <AssistantReply
                    text={text || "Reading the river…"}
                    pending={loading && message === messages.at(-1)}
                    briefing={lastData(message.parts, "data-paddle-briefing")?.data}
                    trip={lastData(message.parts, "data-paddle-trip")?.data}
                    comparison={lastData(message.parts, "data-paddle-comparison")?.data}
                    route={lastData(message.parts, "data-paddle-route")?.data}
                    onRoute={onRoute}
                  />}
            </div>;
          })}
      {error && <div className="msg assistant"><p>⚠️ Paddle Agent could not answer: {error.message}</p></div>}
      <div ref={endRef} />
    </div>

    <form onSubmit={(event) => { event.preventDefault(); ask(input); }}>
      <input value={input} maxLength={CONFIG.chat.maxMessageChars} onChange={(event) => setInput(event.target.value)} placeholder="Ask Paddle Agent about your paddle…" />
      {loading
        ? <button className="send" type="button" onClick={() => void stop()}>Stop</button>
        : <button className="send" disabled={!input.trim() || tooLong}>Send</button>}
      {tooLong && <p className="input-hint" role="status">Keep questions under {CONFIG.chat.maxMessageChars} characters.</p>}
    </form>
  </section>;
}
