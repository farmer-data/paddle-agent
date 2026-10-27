import { distanceNm, pointInPolygon } from "./geo";

export type ZoneId = "upper-hudson" | "midtown-hudson" | "lower-hudson" | "lower-east" | "midtown-east" | "hell-gate";
export type LonLat = [number, number];
export type Zone = { id: ZoneId; name: string; river: "hudson" | "east"; currentStation: string; center: LonLat; shape: LonLat[]; usesHudsonFlow: boolean; beginnerNoGo: boolean };
export type Place = { id: string; name: string; aliases: string[]; kind: "launch" | "landmark"; lonLat: LonLat; zoneId: ZoneId; nodeId: string; note?: string };

// Water polygons traced from Census TIGER areal hydrography (2026): the river within each stretch, pushed
// ~60 m onto land so every near-shore point is inside, with piers filled in and Roosevelt Island cut out
// (Midtown East wraps around it; the island's north tip is the corner shared with Hell Gate).
// Neighbouring zones share their cross-river edges vertex for vertex. `center` is mid-river (NWS point).
export const ZONES: Zone[] = [
  {
    id: "upper-hudson", name: "Upper Hudson", river: "hudson", currentStation: "HUR0611", center: [-73.956, 40.846], usesHudsonFlow: true, beginnerNoGo: false,
    shape: [
      [-73.9741, 40.82439], [-73.961, 40.81835], [-73.95752, 40.82223], [-73.95808, 40.82424], [-73.95725, 40.82601],
      [-73.95401, 40.82752], [-73.94957, 40.83425], [-73.94537, 40.84439], [-73.94594, 40.85026], [-73.94207, 40.85279],
      [-73.93714, 40.85958], [-73.9318, 40.86747], [-73.93164, 40.87011], [-73.92926, 40.87424], [-73.9445, 40.88068],
      [-73.95565, 40.86113], [-73.95824, 40.85953], [-73.9599, 40.85258], [-73.96154, 40.84988], [-73.9659, 40.84378],
      [-73.96884, 40.84133], [-73.97045, 40.83685], [-73.96902, 40.83419], [-73.97024, 40.83181], [-73.97015, 40.83019],
      [-73.97235, 40.82752],
    ],
  },
  {
    id: "midtown-hudson", name: "Midtown Hudson", river: "hudson", currentStation: "NYH1928", center: [-73.993, 40.785], usesHudsonFlow: true, beginnerNoGo: false,
    shape: [
      [-74.024, 40.75307], [-74.00862, 40.75033], [-74.00388, 40.75874], [-74.00076, 40.76235], [-73.99897, 40.76335],
      [-73.99576, 40.76759], [-73.99573, 40.76952], [-73.99166, 40.77548], [-73.961, 40.81835], [-73.9741, 40.82439],
      [-73.97467, 40.82253], [-73.98022, 40.81518], [-73.98367, 40.81387], [-73.98561, 40.81152], [-73.98522, 40.80885],
      [-73.99103, 40.80376], [-73.99529, 40.79868], [-73.99565, 40.79426], [-73.99887, 40.79172], [-73.99886, 40.78905],
      [-74.00278, 40.78394], [-74.00668, 40.78139], [-74.00892, 40.7787], [-74.01107, 40.77782], [-74.0124, 40.77597],
      [-74.01172, 40.77303], [-74.01486, 40.77151], [-74.01834, 40.76506], [-74.02132, 40.76414], [-74.02105, 40.76221],
      [-74.02302, 40.75943], [-74.0278, 40.7575], [-74.02768, 40.7552],
    ],
  },
  {
    id: "lower-hudson", name: "Lower Hudson", river: "hudson", currentStation: "NYH1927", center: [-74.0225, 40.73], usesHudsonFlow: true, beginnerNoGo: false,
    shape: [
      [-74.03554, 40.70636], [-74.017, 40.69274], [-74.01585, 40.69261], [-74.01373, 40.70144], [-74.01525, 40.70179],
      [-74.01672, 40.70327], [-74.0179, 40.70629], [-74.01786, 40.70929], [-74.01566, 40.71312], [-74.01662, 40.71485],
      [-74.01627, 40.71681], [-74.01502, 40.71773], [-74.0129, 40.71788], [-74.01234, 40.71903], [-74.00966, 40.73962],
      [-74.00812, 40.74461], [-74.00862, 40.75033], [-74.024, 40.75307], [-74.02435, 40.74812], [-74.0233, 40.7451],
      [-74.02689, 40.74131], [-74.02873, 40.73503], [-74.03117, 40.73387], [-74.03184, 40.72787], [-74.03516, 40.72619],
      [-74.03491, 40.72204], [-74.03318, 40.7197], [-74.03389, 40.71404], [-74.0352, 40.71269], [-74.0352, 40.7082],
      [-74.03534, 40.70818],
    ],
  },
  {
    id: "lower-east", name: "Lower East River", river: "east", currentStation: "NYH1920", center: [-73.99, 40.7073], usesHudsonFlow: false, beginnerNoGo: false,
    shape: [
      [-74.01585, 40.69261], [-74.01417, 40.69193], [-74.00152, 40.69143], [-73.99588, 40.70158], [-73.99381, 40.70328],
      [-73.98449, 40.70501], [-73.97917, 40.70464], [-73.96914, 40.70945], [-73.96774, 40.71315], [-73.97558, 40.71555],
      [-73.97817, 40.71123], [-73.98293, 40.7102], [-73.987, 40.70987], [-73.98895, 40.71049], [-73.99799, 40.70912],
      [-74.00953, 40.70238], [-74.01373, 40.70144],
    ],
  },
  {
    id: "midtown-east", name: "Midtown East River", river: "east", currentStation: "NYH1922", center: [-73.967, 40.74], usesHudsonFlow: false, beginnerNoGo: false,
    shape: [
      [-73.97558, 40.71555], [-73.96774, 40.71315], [-73.96677, 40.7165], [-73.96196, 40.72253], [-73.96037, 40.72374],
      [-73.95757, 40.7243], [-73.95752, 40.72482], [-73.96049, 40.72696], [-73.96152, 40.73364], [-73.9575, 40.73795],
      [-73.9575, 40.74005], [-73.95924, 40.7403], [-73.96024, 40.74186], [-73.95797, 40.74456], [-73.95758, 40.74689],
      [-73.95659, 40.74794], [-73.956, 40.75], [-73.95374, 40.75082], [-73.9409, 40.76642], [-73.93813, 40.76789],
      [-73.94074, 40.77073], [-73.94158, 40.76957], [-73.94325, 40.76849], [-73.95364, 40.7566], [-73.96053, 40.75062],
      [-73.95865, 40.75336], [-73.94427, 40.76964], [-73.94185, 40.77175], [-73.94074, 40.77208], [-73.94022, 40.77295],
      [-73.94485, 40.77349], [-73.95947, 40.75847], [-73.9725, 40.74299], [-73.97341, 40.73809], [-73.97522, 40.73574],
      [-73.97418, 40.73141], [-73.97229, 40.72951], [-73.97201, 40.72746],
    ],
  },
  {
    id: "hell-gate", name: "Hell Gate", river: "east", currentStation: "NYH1924", center: [-73.9395, 40.7765], usesHudsonFlow: false, beginnerNoGo: true,
    shape: [
      [-73.94485, 40.77349], [-73.94022, 40.77295], [-73.94074, 40.77073], [-73.93813, 40.76789], [-73.93516, 40.76903],
      [-73.93401, 40.77037], [-73.93432, 40.77201], [-73.93622, 40.77277], [-73.93709, 40.77393], [-73.93559, 40.77668],
      [-73.9331, 40.77742], [-73.92979, 40.7757], [-73.92593, 40.77773], [-73.9249, 40.78268], [-73.92829, 40.78187],
      [-73.93472, 40.78367], [-73.939, 40.78], [-73.94418, 40.78], [-73.94282, 40.77644],
    ],
  },
];

// Launches are on the NYC Parks Water Trail list (nycgovparks.org/facilities/kayak) and open, except Hoboken
// Cove (City of Hoboken / Hoboken Cove Community Boathouse). Points sit at the put-in; the Roosevelt Island
// lighthouse point is just off the tip in the west channel.
export const PLACES: Place[] = [
  { id: "dyckman-street", name: "Dyckman Street (Inwood Hill Park)", aliases: ["dyckman", "dyckman street", "dyckman st", "inwood"], kind: "launch", lonLat: [-73.93203, 40.86959], zoneId: "upper-hudson", nodeId: "m01", note: "Sand beach just north of the fishing pier at the west end of Dyckman St." },
  { id: "pier-96", name: "Pier 96 (Clinton Cove)", aliases: ["pier 96", "clinton cove", "56th street"], kind: "launch", lonLat: [-73.996, 40.771], zoneId: "midtown-hudson", nodeId: "m20", note: "Pier 96 Boathouse at W 56th St, Hudson River Park." },
  { id: "pier-84", name: "Pier 84", aliases: ["pier 84", "44th street"], kind: "launch", lonLat: [-74.0016, 40.7641], zoneId: "midtown-hudson", nodeId: "m22", note: "W 44th St. High docks; cruise ships and ferries nearby." },
  { id: "pier-66", name: "Pier 66", aliases: ["pier 66", "26th street"], kind: "launch", lonLat: [-74.0089, 40.7525], zoneId: "midtown-hudson", nodeId: "m24", note: "Pier 66 Boathouse at W 26th St, Hudson River Park." },
  { id: "pier-40", name: "Pier 40", aliases: ["pier 40", "houston street"], kind: "launch", lonLat: [-74.01375, 40.72833], zoneId: "lower-hudson", nodeId: "m31", note: "Floating dock on the south side of Pier 40, W Houston St." },
  { id: "pier-26", name: "Pier 26 (Tribeca)", aliases: ["pier 26", "tribeca", "downtown boathouse"], kind: "launch", lonLat: [-74.0134, 40.7215], zoneId: "lower-hudson", nodeId: "m32", note: "Downtown Boathouse at Hubert St, Hudson River Park." },
  { id: "hoboken-cove", name: "Hoboken Cove (Maxwell Place Park)", aliases: ["hoboken", "hoboken cove", "maxwell place"], kind: "launch", lonLat: [-74.02366, 40.74845], zoneId: "lower-hudson", nodeId: "n24", note: "Sand beach by the Hoboken Cove Community Boathouse." },
  { id: "brooklyn-bridge-park", name: "Brooklyn Bridge Park (Pier 4 Beach)", aliases: ["brooklyn bridge park", "pier 4 beach", "bbp"], kind: "launch", lonLat: [-73.99912, 40.69654], zoneId: "lower-east", nodeId: "b02", note: "Steep, rocky beach; watch for wakes and strong current." },
  { id: "hunters-point-south", name: "Hunter's Point South Park", aliases: ["hunters point", "hunters point south", "long island city", "lic"], kind: "launch", lonLat: [-73.96024, 40.73832], zoneId: "midtown-east", nodeId: "b17", note: "Slipway at the mouth of Newtown Creek, 56th Ave & 2nd St." },
  { id: "hallets-cove", name: "Hallets Cove (Socrates Sculpture Park)", aliases: ["hallets cove", "hallet's cove", "socrates", "astoria"], kind: "launch", lonLat: [-73.93564, 40.76941], zoneId: "hell-gate", nodeId: "b24", note: "Beach at the north end of Socrates Sculpture Park. Calm in the cove, strong current just outside." },
  { id: "little-red-lighthouse", name: "Little Red Lighthouse", aliases: ["little red lighthouse", "red lighthouse", "george washington bridge", "gwb"], kind: "landmark", lonLat: [-73.94696, 40.85026], zoneId: "upper-hudson", nodeId: "m05", note: "Under the George Washington Bridge." },
  { id: "intrepid", name: "Intrepid Museum (Pier 86)", aliases: ["intrepid", "pier 86"], kind: "landmark", lonLat: [-73.9996, 40.7646], zoneId: "midtown-hudson", nodeId: "m21" },
  { id: "brooklyn-bridge", name: "Brooklyn Bridge", aliases: ["brooklyn bridge"], kind: "landmark", lonLat: [-73.99702, 40.70622], zoneId: "lower-east", nodeId: "m40" },
  { id: "williamsburg-bridge", name: "Williamsburg Bridge", aliases: ["williamsburg bridge"], kind: "landmark", lonLat: [-73.97214, 40.71358], zoneId: "lower-east", nodeId: "m44" },
  { id: "roosevelt-island-lighthouse", name: "Roosevelt Island Lighthouse", aliases: ["roosevelt island lighthouse", "blackwell island light", "lighthouse park"], kind: "landmark", lonLat: [-73.9409, 40.7726], zoneId: "midtown-east", nodeId: "m55", note: "North tip of Roosevelt Island; Hell Gate starts just beyond." },
];

export const DEFAULT_ZONE: ZoneId = "lower-hudson";

const byId = new Map(ZONES.map((z) => [z.id, z]));
export const zoneById = (id: ZoneId) => byId.get(id)!;
export const isZoneId = (x: unknown): x is ZoneId => typeof x === "string" && byId.has(x as ZoneId);
export const zoneAt = (p: LonLat): ZoneId | null => ZONES.find((z) => pointInPolygon(p, z.shape))?.id ?? null;
export const nearestZone = (p: LonLat): ZoneId =>
  zoneAt(p) ?? ZONES.reduce((best, z) => (distanceNm(p, z.center) < distanceNm(p, best.center) ? z : best)).id;
