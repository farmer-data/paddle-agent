import type { LonLat } from "./zones";

const RAD = Math.PI / 180;
const EARTH_NM = 3440.065;

export function distanceNm([lon1, lat1]: LonLat, [lon2, lat2]: LonLat) {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_NM * Math.asin(Math.sqrt(h));
}

// Initial compass bearing from a to b, 0–360 clockwise from north.
export function bearingDeg([lon1, lat1]: LonLat, [lon2, lat2]: LonLat) {
  const dLon = (lon2 - lon1) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export const angleDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// Ray casting; fine at harbour scale where lon/lat is effectively planar.
export function pointInPolygon([x, y]: LonLat, poly: LonLat[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const lerp = (a: LonLat, b: LonLat, t: number): LonLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
