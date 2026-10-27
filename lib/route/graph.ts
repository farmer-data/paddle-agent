import { distanceNm } from "../geo";
import { PLACES, nearestZone, zoneAt, type LonLat, type Place, type ZoneId } from "../zones";
import { CROSSINGS, SHORE_LINES } from "./waterways";

export type Bank = "manhattan" | "nj" | "brooklyn-queens";
export type GNode = { id: string; lonLat: LonLat; bank: Bank };
export type GEdge = { a: string; b: string; kind: "shore" | "crossing"; zoneId: ZoneId; nm: number };

export const NODES: GNode[] = (Object.keys(SHORE_LINES) as Bank[]).flatMap((bank) => SHORE_LINES[bank].map(([id, lon, lat]) => ({ id, lonLat: [lon, lat] as LonLat, bank })));
const byId = new Map(NODES.map((n) => [n.id, n]));

function edge(a: string, b: string, kind: GEdge["kind"]): GEdge {
  const pa = byId.get(a)!.lonLat, pb = byId.get(b)!.lonLat;
  const mid: LonLat = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  return { a, b, kind, zoneId: zoneAt(mid) ?? nearestZone(mid), nm: distanceNm(pa, pb) };
}

export const EDGES: GEdge[] = [
  ...(Object.keys(SHORE_LINES) as Bank[]).flatMap((bank) => SHORE_LINES[bank].slice(1).map(([id], i) => edge(SHORE_LINES[bank][i][0], id, "shore"))),
  ...CROSSINGS.map(([a, b]) => edge(a, b, "crossing")),
];

const adj = new Map<string, { to: string; e: GEdge }[]>(NODES.map((n) => [n.id, []]));
for (const e of EDGES) { adj.get(e.a)!.push({ to: e.b, e }); adj.get(e.b)!.push({ to: e.a, e }); }

// Dijkstra by nm. The graph is small (~120 nodes), so a linear scan for the next node is fine.
export function shortestPath(from: string, to: string, opts: { allowCrossings: boolean }): { nodes: string[]; edges: GEdge[] } | null {
  if (!adj.has(from) || !adj.has(to)) return null;
  const dist = new Map<string, number>([[from, 0]]), prev = new Map<string, { node: string; e: GEdge }>(), done = new Set<string>();
  for (;;) {
    let u: string | null = null, best = Infinity;
    for (const [id, d] of dist) if (!done.has(id) && d < best) { u = id; best = d; }
    if (u === null) return null;
    if (u === to) break;
    done.add(u);
    for (const { to: v, e } of adj.get(u)!) {
      if (e.kind === "crossing" && !opts.allowCrossings) continue;
      const nd = best + e.nm;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, { node: u, e }); }
    }
  }
  const nodes = [to], edges: GEdge[] = [];
  for (let at = to; at !== from;) { const p = prev.get(at)!; edges.unshift(p.e); nodes.unshift(p.node); at = p.node; }
  return { nodes, edges };
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/['’.]/g, "").replace(/\bpier\s*(\d+)/g, "pier $1").replace(/[^a-z0-9]+/g, " ").replace(/\bthe\b/g, " ").replace(/\s+/g, " ").trim()} `;
const PLACE_KEYS = PLACES.flatMap((p) => [p.name, ...p.aliases].map((k) => ({ p, key: norm(k) })));

// Longest name or alias that appears in the text as whole words.
export function findPlace(text: string): Place | null {
  const t = norm(text);
  let best: { p: Place; len: number } | null = null;
  for (const { p, key } of PLACE_KEYS) if (key.trim() && t.includes(key) && (!best || key.length > best.len)) best = { p, len: key.length };
  return best?.p ?? null;
}
