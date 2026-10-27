// Pure: estimates a paddle's duration from the predicted current and wind along the way. Runs in the browser.
import { CONFIG, type Mode } from "../config";
import { angleDiff, bearingDeg, lerp } from "../geo";
import type { ZoneOutlook } from "../outlook";
import { hourKey, nyStamp, wallMinutes, wallStamp } from "../time";
import type { Verdict } from "../verdict";
import { PLACES, type LonLat, type Place, type ZoneId } from "../zones";
import { findPlace, NODES, shortestPath, type GEdge } from "./graph";

export type RouteRequest = { fromId: string; toId: string; depart: string; outAndBack?: boolean; turnaround?: string };
export type RouteSegment = { from: LonLat; to: LonLat; zoneId: ZoneId; kind: "shore" | "crossing"; risk: Verdict; at: string; groundKn: number; warning: string | null };
export type RoutePlan = {
  request: RouteRequest; fromName: string; toName: string; distanceNm: number; durationMin: number; eta: string; worst: Verdict;
  segments: RouteSegment[]; blocked: "hell-gate" | "crossing" | null; warnings: string[];
  suggestion: { depart: string; durationMin: number; allGreen: boolean } | null; caveat: string;
};

const CAVEAT = "Planning estimate, not a guarantee of safe passage.";
const NO_HEADWAY = "You won't make headway here";
const TOO_LONG = "Too long for one outing";
const HELL_GATE_BLOCK = "Not for first-season paddlers";
const CROSSING_BLOCK = "Crosses a ferry lane — not for first-season paddlers";
const FERRY_LANE = "Ferry lane — cross quickly, look both ways, cross at a right angle";
const RAD = Math.PI / 180;
const RANK: Record<Verdict, number> = { safe: 0, caution: 1, unknown: 2, danger: 3 };

const nodeById = new Map(NODES.map((n) => [n.id, n]));
const placeOf = (ref: string): Place => {
  const p = PLACES.find((x) => x.id === ref) ?? findPlace(ref);
  if (!p) throw new Error(`Unknown place: ${ref}`);
  return p;
};
const worstOf = (vs: Verdict[]): Verdict => vs.reduce<Verdict>((w, v) => (RANK[v] > RANK[w] ? v : w), "safe");

type Leg = { from: LonLat; to: LonLat; edge: GEdge };
const legsOf = (nodes: string[], edges: GEdge[]): Leg[] =>
  edges.map((edge, i) => ({ from: nodeById.get(nodes[i])!.lonLat, to: nodeById.get(nodes[i + 1])!.lonLat, edge }));

function chooseRoute(from: Place, to: Place, mode: Mode) {
  if (mode === "experienced") return { path: shortestPath(from.nodeId, to.nodeId, { allowCrossings: true }), blocked: null as RoutePlan["blocked"] };
  const shore = shortestPath(from.nodeId, to.nodeId, { allowCrossings: false });
  const path = shore ?? shortestPath(from.nodeId, to.nodeId, { allowCrossings: true });
  // An endpoint launch in Hell Gate counts even when the last shore edge's midpoint falls in the neighbouring zone.
  const inGate = path?.edges.some((e) => e.zoneId === "hell-gate") || from.zoneId === "hell-gate" || to.zoneId === "hell-gate";
  const blocked = inGate ? "hell-gate" : shore ? null : "crossing";
  return { path, blocked: blocked as RoutePlan["blocked"] };
}

function plan(req: RouteRequest, outlooks: Record<ZoneId, ZoneOutlook>, mode: Mode): Omit<RoutePlan, "suggestion"> {
  const from = placeOf(req.fromId), to = placeOf(req.toId);
  const { path, blocked } = chooseRoute(from, to, mode);
  if (!path) throw new Error(`No water route from ${from.name} to ${to.name}`);
  if (!path.edges.length) throw new Error("Start and destination are the same place");
  const out = legsOf(path.nodes, path.edges);
  const back = req.outAndBack ? legsOf([...path.nodes].reverse(), [...path.edges].reverse()) : [];

  const hoursByZone = new Map<ZoneId, Map<string, ZoneOutlook["hours"][number]>>();
  const hourAt = (zone: ZoneId, t: number) => {
    if (!hoursByZone.has(zone)) hoursByZone.set(zone, new Map(outlooks[zone].hours.map((h) => [h.key, h])));
    return hoursByZone.get(zone)!.get(hourKey(wallStamp(t)));
  };

  const { paddleKn, headwindPenalty, minHeadwayKn, stepMin, maxHours } = CONFIG.route;
  const start = wallMinutes(req.depart);
  let t = start, paddled = 0, distanceNm = 0, tooLong = false;
  const segments: RouteSegment[] = [];
  const warnings: string[] = [];
  const warn = (w: string) => { if (!warnings.includes(w)) warnings.push(w); };

  const walk = (legs: Leg[]) => {
    for (const leg of legs) {
      const bearing = bearingDeg(leg.from, leg.to);
      const lengthNm = leg.edge.nm;
      let doneNm = 0;
      while (doneNm < lengthNm - 1e-9) {
        if (paddled >= maxHours * 60) { tooLong = true; return; }
        const hour = hourAt(leg.edge.zoneId, t);
        const along = hour?.current != null && hour.currentTowardDeg != null ? Math.abs(hour.current) * Math.cos((hour.currentTowardDeg - bearing) * RAD) : 0;
        const headwind = hour?.windKnots != null && hour.windFromDeg != null ? Math.max(0, hour.windKnots * Math.cos(angleDiff(hour.windFromDeg, bearing) * RAD)) : 0;
        const groundKn = paddleKn[mode] + along - headwindPenalty * headwind;
        const noHeadway = groundKn < minHeadwayKn;
        const speed = noHeadway ? minHeadwayKn : groundKn;
        const stepNm = Math.min(lengthNm - doneNm, (speed * stepMin) / 60);
        const dt = (stepNm / speed) * 60;
        let warning: string | null = null;
        if (blocked) warning = blocked === "hell-gate" ? HELL_GATE_BLOCK : CROSSING_BLOCK;
        else if (leg.edge.kind === "crossing") warning = FERRY_LANE;
        else if (noHeadway) warning = NO_HEADWAY;
        if (noHeadway) warn(NO_HEADWAY);
        if (warning) warn(warning);
        segments.push({
          from: lerp(leg.from, leg.to, doneNm / lengthNm), to: lerp(leg.from, leg.to, (doneNm + stepNm) / lengthNm),
          zoneId: leg.edge.zoneId, kind: leg.edge.kind,
          risk: blocked ? "danger" : hour?.risk ?? "unknown", at: wallStamp(t), groundKn: speed, warning,
        });
        doneNm += stepNm; distanceNm += stepNm; t += dt; paddled += dt;
      }
    }
  };

  walk(out);
  if (back.length && !tooLong) {
    if (req.turnaround) t = Math.max(t, wallMinutes(req.turnaround));
    walk(back);
  }
  if (tooLong) warn(TOO_LONG);
  // The unwalked remainder was never assessed, so a capped plan can't read better than unknown.
  const worst = worstOf([...segments.map((s) => s.risk), ...(tooLong ? (["unknown"] as Verdict[]) : [])]);

  return {
    request: req, fromName: from.name, toName: to.name, distanceNm, durationMin: Math.round(t - start), eta: wallStamp(Math.round(t)),
    worst, segments, blocked, warnings, caveat: CAVEAT,
  };
}

export function planRoute(req: RouteRequest, outlooks: Record<ZoneId, ZoneOutlook>, mode: Mode, now: Date): RoutePlan {
  const base = plan(req, outlooks, mode);
  return { ...base, suggestion: base.blocked ? null : suggest(req, base, outlooks, mode, now) };
}

function suggest(req: RouteRequest, base: Omit<RoutePlan, "suggestion">, outlooks: Record<ZoneId, ZoneOutlook>, mode: Mode, now: Date) {
  const { departureStepMin } = CONFIG.route;
  const sunset = wallMinutes(outlooks[placeOf(req.fromId).zoneId].sun.sunset);
  const nowMin = wallMinutes(nyStamp(now));
  let best: { depart: string; durationMin: number; allGreen: boolean } | null = null;
  for (let d = (Math.floor(nowMin / departureStepMin) + 1) * departureStepMin; d <= sunset; d += departureStepMin) {
    const depart = wallStamp(d);
    const p = depart === req.depart ? base : plan({ ...req, depart }, outlooks, mode);
    if (p.warnings.includes(TOO_LONG) || wallMinutes(p.eta) > sunset || p.segments.some((s) => s.risk === "danger" || s.risk === "unknown")) continue;
    const allGreen = p.segments.every((s) => s.risk === "safe");
    const better = !best || (allGreen && !best.allGreen) || (allGreen === best.allGreen && p.durationMin < best.durationMin);
    if (better) best = { depart, durationMin: p.durationMin, allGreen };
  }
  return best;
}

const hm = (stamp: string) => stamp.slice(11, 16);
export function summarizeRoute(p: RoutePlan): string {
  const head = `${p.fromName} to ${p.toName}${p.request.outAndBack ? " and back" : ""}: ${p.distanceNm.toFixed(1)} nm, about ${p.durationMin} min, leaving ${hm(p.request.depart)}, arriving ${hm(p.eta)}`;
  const tail = p.blocked ? `BLOCKED for beginners (${p.blocked})` : `worst conditions ${p.worst}`;
  const sug = p.suggestion ? `; best departure ${hm(p.suggestion.depart)} (${p.suggestion.durationMin} min${p.suggestion.allGreen ? ", all green" : ""})` : "";
  return `${head}; ${tail}${p.warnings.length ? `; ${p.warnings.join("; ")}` : ""}${sug}. ${p.caveat}`;
}
