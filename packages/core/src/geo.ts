import type { GeoPoint } from "./contracts.ts";

const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km. Good enough; we are not routing aircraft. */
export const haversineKm = (a: GeoPoint, b: GeoPoint): number => {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
};

/** Road distance is longer than straight-line. Standard detour factor for road freight. */
export const ROAD_DETOUR_FACTOR = 1.3;
export const roadDistanceKm = (a: GeoPoint, b: GeoPoint): number =>
  haversineKm(a, b) * ROAD_DETOUR_FACTOR;
