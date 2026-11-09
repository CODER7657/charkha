/**
 * Where to look after a matching round (#91): the bounding box of the round's routes.
 *
 * A route is at most ~60 km, which is about 13 px at the country-wide opening zoom: in the
 * DOM, but unreadable on a projector. Fitting to the round's own routes keeps the view
 * driven by the data (nothing hardcoded) and makes the lines long enough to read.
 */

export type LatLon = [number, number];
export type Bounds = [LatLon, LatLon]; // [[south, west], [north, east]]

/** Smallest box that is still worth fitting to (degrees): one route never zooms to a street. */
export const MIN_SPAN_DEG = 0.4;

export function routeBounds(lines: readonly { from: LatLon; to: LatLon }[]): Bounds | null {
  const points = lines.flatMap((l) => [l.from, l.to]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (points.length === 0) return null;
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const [lat, lon] of points) {
    s = Math.min(s, lat);
    n = Math.max(n, lat);
    w = Math.min(w, lon);
    e = Math.max(e, lon);
  }
  const padLat = Math.max(0, (MIN_SPAN_DEG - (n - s)) / 2);
  const padLon = Math.max(0, (MIN_SPAN_DEG - (e - w)) / 2);
  return [
    [s - padLat, w - padLon],
    [n + padLat, e + padLon],
  ];
}
