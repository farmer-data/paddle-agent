"use client";

import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, Cell, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HourlyRisk, PaddleWindow } from "@/lib/windows";

type Condition = { parameter: string; value: number; ts: string };
type Risk = "safe" | "caution" | "danger";
type Assessment = { verdict: Risk; opposingWind: boolean; factors: { discharge: Risk; current: Risk; wind: Risk } };
type Briefing = { summary: string; updatedAt: string; assessment?: Assessment };
type ReplyCard = {
  headline: string;
  stats: { value: string; label: string; feel: string }[];
  launch: { time: string; why: string } | null;
  note: string;
  action: { label: string; hccb: boolean };
};
type Forecast = { label: string; isNow: boolean; verdict: Risk | null; opposingWind: boolean };
type Message = { role: "user" | "assistant"; text: string; pending?: boolean; card?: ReplyCard | null; verdict?: Risk | null; hourly?: HourlyRisk[]; window?: PaddleWindow | null; forecast?: Forecast | null };

const HCCB_URL = "https://sites.google.com/hobokencoveboathouse.org/hccb/home";

const feelFor = (knots: number) =>
  knots < 4 ? "glass — barely a ripple" :
  knots < 7 ? "soft ripples, easy water" :
  knots < 10 ? "light chop building" :
  knots < 15 ? "working water — brace your stroke" : "whitecaps — stay ashore";

const prompts = ["Can I paddle Sunday morning with a beginner?", "Find low-wind paddle windows", "Show current Hudson conditions"];

const verdictTheme: Record<Risk, { color: string; word: string }> = {
  safe: { color: "var(--go)", word: "GO" },
  caution: { color: "var(--caution)", word: "CAUTION" },
  danger: { color: "var(--nogo)", word: "NO-GO" },
};

const gaugeSpecs = [
  { key: "wind_speed", label: "Wind", unit: "kn", max: 22, caution: 10, danger: 15, factor: "wind" as const, format: (v: number) => v.toFixed(1) },
  { key: "current_speed", label: "Current", unit: "kn", max: 3.5, caution: 1.5, danger: 2.5, factor: "current" as const, format: (v: number) => v.toFixed(1) },
  { key: "discharge", label: "River flow", unit: "cfs", max: 32000, caution: 15000, danger: 25000, factor: "discharge" as const, format: (v: number) => Math.round(v).toLocaleString() },
];

const cardinal = (deg: number) =>
  ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

// ---- agent reply parsing --------------------------------------------------
type ParsedReply = { verdict: Risk | null; headline: string; sections: { label: string; lines: string[] }[]; raw: string };
const sectionPattern = /^(WHY IT MATTERS|BEST MOVE|GUIDE'S NOTE|RIVER MEMORY|NEXT ACTION)\b[\s:→\-—–]*(.*)$/;

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
function Gauge({ spec, value, risk }: { spec: (typeof gaugeSpecs)[number]; value?: number; risk?: Risk }) {
  const theme = risk ? verdictTheme[risk] : undefined;
  const fill = value === undefined ? 0 : Math.min(value / spec.max, 1) * 100;
  return (
    <div className="gauge" style={{ "--risk-color": theme?.color ?? "var(--faint)" } as React.CSSProperties}>
      <div className="gauge-label"><span>{spec.label}</span><span className="gauge-risk">{risk ? verdictTheme[risk].word : "—"}</span></div>
      <div className="gauge-value">{value === undefined ? "—" : spec.format(value)}<small>{spec.unit}</small></div>
      <div className="gauge-track">
        <span className="gauge-tick" style={{ left: `${(spec.caution / spec.max) * 100}%` }} />
        <span className="gauge-tick danger" style={{ left: `${(spec.danger / spec.max) * 100}%` }} />
        <div className="gauge-fill" style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}

function Compass({ deg }: { deg?: number }) {
  return (
    <div className="gauge compass">
      <div className="gauge-label"><span>Wind from</span></div>
      <div className="compass-face">
        <svg width="60" height="60" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="27" fill="none" stroke="var(--line-strong)" />
          {["N", "E", "S", "W"].map((point, index) => (
            <text key={point} x={30 + 22 * Math.sin((index * Math.PI) / 2)} y={31.5 - 22 * Math.cos((index * Math.PI) / 2)}
              textAnchor="middle" dominantBaseline="middle" fill="var(--faint)" fontSize="7" fontFamily="var(--mono)">{point}</text>
          ))}
          {deg !== undefined && (
            <g className="compass-needle" style={{ transform: `rotate(${deg}deg)` }}>
              <polygon points="30,12 33,32 30,28 27,32" fill="var(--cyan)" />
            </g>
          )}
        </svg>
        <div className="compass-reading">
          {deg === undefined ? "—" : `${cardinal(deg)} ${Math.round(deg)}°`}
          <small>Robbins Reef</small>
        </div>
      </div>
    </div>
  );
}

function PaddleTimeline({ hourly, window, title }: { hourly: HourlyRisk[]; window?: PaddleWindow | null; title?: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const picked = selected !== null ? hourly[selected] : null;
  return (
    <div className="timeline">
      <div className="timeline-head">
        <h4>{title ? `${title} · wind` : `Next ${hourly.length} hours · wind`}</h4>
        {window && (
          <span className="window-chip" style={{ "--risk-color": verdictTheme[window.risk].color } as React.CSSProperties}>
            Best window {window.startLabel}–{window.endLabel}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={132}>
        <BarChart data={hourly} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap="22%">
          {window && (
            <ReferenceArea x1={hourly[window.startIndex].hourLabel} x2={hourly[window.endIndex].hourLabel}
              fill={verdictTheme[window.risk].color} fillOpacity={0.12} stroke={verdictTheme[window.risk].color} strokeOpacity={0.35} strokeDasharray="3 3" />
          )}
          <ReferenceLine y={10} stroke="var(--caution)" strokeOpacity={0.4} strokeDasharray="4 4" />
          <ReferenceLine y={15} stroke="var(--nogo)" strokeOpacity={0.4} strokeDasharray="4 4" />
          <XAxis dataKey="hourLabel" tickLine={false} axisLine={false} interval={1} tick={{ fill: "var(--faint)", fontSize: 10, fontFamily: "var(--mono)" }} />
          <YAxis width={26} unit="" tickLine={false} axisLine={false} tick={{ fill: "var(--faint)", fontSize: 10, fontFamily: "var(--mono)" }} />
          <Tooltip cursor={{ fill: "rgba(27, 159, 216, 0.08)" }} contentStyle={{ background: "var(--deep)", border: "1px solid var(--line-strong)", borderRadius: 10, fontSize: 12, boxShadow: "0 10px 24px -14px rgba(13, 51, 73, 0.4)" }}
            labelStyle={{ color: "var(--muted)" }} itemStyle={{ color: "var(--text)" }}
            formatter={(value, _name, item) => [`${value ?? "—"} kn ${(item?.payload as HourlyRisk | undefined)?.direction ?? ""}`, "wind"]} />
          <Bar dataKey="windKnots" radius={[3, 3, 0, 0]} isAnimationActive={false} cursor="pointer"
            onClick={(_, index) => setSelected(index === selected ? null : index)}>
            {hourly.map((hour, index) => (
              <Cell key={hour.ts} fill={verdictTheme[hour.risk].color}
                fillOpacity={selected === null ? 0.85 : selected === index ? 1 : 0.35}
                stroke={selected === index ? verdictTheme[hour.risk].color : undefined} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {picked ? (
        <p className="hour-detail" style={{ "--risk-color": verdictTheme[picked.risk].color } as React.CSSProperties}>
          <strong>{picked.hourLabel}</strong> · {picked.windKnots} kt {picked.direction} · <span className="hour-risk">{verdictTheme[picked.risk].word}</span> · {feelFor(picked.windKnots)}
        </p>
      ) : (
        <p className="timeline-legend">tap an hour to read the water · dashed lines = caution / no-go wind</p>
      )}
    </div>
  );
}

function CardReply({ card, verdict, hourly, window, windowLabel, onAsk }: { card: ReplyCard; verdict?: Risk | null; hourly?: HourlyRisk[]; window?: PaddleWindow | null; windowLabel?: string; onAsk: (q: string) => void }) {
  const theme = verdict ? verdictTheme[verdict] : undefined;
  return (
    <div className="reply card-reply" style={{ "--verdict-color": theme?.color } as React.CSSProperties}>
      <div className="reply-topbar">
        {theme && <span className="verdict-chip">{theme.word}</span>}
        <span>Paddle Agent briefing</span>
      </div>
      <div className="reply-body">
        <p className="reply-headline">{card.headline}</p>
        <div className="stat-row">
          {card.stats.map((stat) => (
            <div className="stat-chip" key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
              <em>{stat.feel}</em>
            </div>
          ))}
          {card.launch && (
            <div className="stat-chip launch">
              <strong>{card.launch.time}</strong>
              <span>launch</span>
              <em>{card.launch.why}</em>
            </div>
          )}
        </div>
        {hourly && hourly.length > 0 && <PaddleTimeline hourly={hourly} window={window} title={windowLabel} />}
        <p className="guide-note">“{card.note}”</p>
        <div className="action-row">
          {card.action.hccb ? (
            <a className="action-btn" href={HCCB_URL} target="_blank" rel="noreferrer">{card.action.label} ↗</a>
          ) : (
            <button type="button" className="action-btn" onClick={() => onAsk("Give me the latest read before I launch")}>{card.action.label}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantReply({ text, pending, hourly, window, windowLabel }: { text: string; pending?: boolean; hourly?: HourlyRisk[]; window?: PaddleWindow | null; windowLabel?: string }) {
  const parsed = parseReply(text);
  const theme = parsed.verdict ? verdictTheme[parsed.verdict] : undefined;
  return (
    <div className={`reply${pending ? " pending" : ""}`} style={{ "--verdict-color": theme?.color } as React.CSSProperties}>
      <div className="reply-topbar">
        {theme && <span className="verdict-chip">{theme.word}</span>}
        <span>{pending ? "Instant read · saved snapshot" : "Paddle Agent briefing"}</span>
      </div>
      <div className="reply-body">
        {parsed.headline && <p className="reply-headline">{parsed.headline}</p>}
        {parsed.sections.length > 0
          ? parsed.sections.map((section, index) => (
              <div key={section.label} className={`reply-section${section.label === "NEXT ACTION" ? " action" : ""}${section.label === "GUIDE'S NOTE" ? " note" : ""}`} style={{ "--i": index } as React.CSSProperties}>
                <h4>{section.label}</h4>
                <ul>{section.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
              </div>
            ))
          : !parsed.headline && <p className="reply-plain">{text}</p>}
        {hourly && hourly.length > 0 && <PaddleTimeline hourly={hourly} window={window} title={windowLabel} />}
      </div>
      {pending && <div className="thinking">Full briefing incoming<span className="dots"><i /><i /><i /></span></div>}
    </div>
  );
}

// ---- main component -------------------------------------------------------
export function KayakChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [readings, setReadings] = useState<Condition[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const refreshSnapshot = async () => {
    const response = await fetch("/api/conditions", { cache: "no-store" });
    const data = await response.json();
    if (response.ok) { setReadings(data.readings); setBriefing(data.briefing); }
  };
  useEffect(() => { void refreshSnapshot(); }, []);
  useEffect(() => { if (messages.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, loading]);

  const ask = async (question: string) => {
    if (!question.trim() || loading) return;
    setInput(""); setLoading(true);
    setMessages((old) => [...old, { role: "user", text: question }, { role: "assistant", text: briefing?.summary ?? "Loading the saved river snapshot…", pending: true }]);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: question }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not get a response");
      setReadings(data.readings); setBriefing(data.briefing);
      setMessages((old) => old.map((item, index) => index === old.length - 1 ? { role: "assistant", text: data.text ?? "", card: data.card, verdict: data.forecast ? data.forecast.verdict : (data.briefing?.assessment?.verdict ?? null), hourly: data.hourly, window: data.window, forecast: data.forecast } : item));
    } catch (error) {
      setMessages((old) => old.map((item, index) => index === old.length - 1 ? { role: "assistant", text: `⚠️ Saved data is available, but the guide is temporarily unavailable: ${error instanceof Error ? error.message : "unknown error"}` } : item));
    } finally { setLoading(false); }
  };

  const values = Object.fromEntries(readings.map((reading) => [reading.parameter, reading.value]));
  const assessment = briefing?.assessment;
  const verdict = assessment ? verdictTheme[assessment.verdict] : undefined;

  return <section className="chat">
    <div className="verdict-hero" style={{ "--verdict-color": verdict?.color } as React.CSSProperties}>
      <div className="lamp" />
      <div className="verdict-copy">
        <span className="verdict-word">{verdict ? verdict.word : "Reading the river…"}</span>
        <p>{briefing ? briefing.summary.replace(/^[🟢🟡🔴]\s*(GO|CAUTION|NO-GO)\s*[—–-]?\s*/u, "") : "Connecting to the saved ClickHouse snapshot…"}</p>
        <div className="verdict-meta">
          {briefing ? <>Snapshot {briefing.updatedAt} · {readings.length} readings</> : "ClickHouse · connecting"}
          <button type="button" onClick={() => void refreshSnapshot()}>Refresh</button>
        </div>
      </div>
      {assessment?.opposingWind && <span className="opposing-flag">⚠ wind against the ebb</span>}
    </div>

    <div className="gauges">
      {gaugeSpecs.map((spec) => <Gauge key={spec.key} spec={spec} value={values[spec.key]} risk={assessment?.factors[spec.factor]} />)}
      <Compass deg={values.wind_dir} />
    </div>

    <div className="prompts">{prompts.map((prompt) => <button key={prompt} onClick={() => void ask(prompt)} disabled={loading}>{prompt}</button>)}</div>

    <div className="messages">
      {messages.length === 0
        ? <div className="empty-state">
            <span className="empty-glyph">🛶</span>
            <p>Ask about your paddle.</p>
          </div>
        : messages.map((message, i) => (
            <div key={i} className={`msg ${message.role}`}>
              {message.role === "user"
                ? <p>{message.text}</p>
                : message.card
                  ? <CardReply card={message.card} verdict={message.verdict} hourly={message.hourly} window={message.window} windowLabel={message.forecast && !message.forecast.isNow ? message.forecast.label : undefined} onAsk={ask} />
                  : <AssistantReply text={message.text} pending={message.pending} hourly={message.hourly} window={message.window} windowLabel={message.forecast && !message.forecast.isNow ? message.forecast.label : undefined} />}
            </div>
          ))}
      <div ref={endRef} />
    </div>

    <form onSubmit={(event) => { event.preventDefault(); void ask(input); }}>
      <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask Paddle Agent about your paddle…" />
      <button className="send" disabled={loading}>{loading ? "Briefing…" : "Send"}</button>
    </form>
  </section>;
}
