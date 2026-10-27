// maplibre-gl 6 locates its web worker next to its own bundle, which a Next bundle breaks.
// Serve the (self-contained) worker from /maplibre/ instead; paddle-map.tsx points at it.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre/maplibre-gl-worker.mjs");
