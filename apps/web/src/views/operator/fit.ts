import { haversineKm } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: Harsh
 *
 * Where the map should look, as pure geometry. No Leaflet, no React - the
 * view turns a Bounds into a fitBounds call, and everything that decides
 * WHICH bounds is here, where a test can drive it without a map.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The map opens on India (#86), which is the right scale for the problem.
 * At zoom 5 a 60 km route is about 13 pixels: the polylines are in the DOM
 * and correct, and on a projector they read as an orange dot touching a
 * green square. `Run matching` is the click the whole screen builds to, and
 * what a judge saw was "the numbers changed".
 *
 * THE MEASUREMENT THAT SHAPED THIS
 *
 * Fitting to every matched route does NOT fix it. Measured on the deployed
 * host: matched lots span lat 9.91-31.88, lon 73.52-85.22 - Tamil Nadu to
 * Punjab, a diagonal of roughly 2,500 km. Fitting to all of them returns
 * almost exactly the national view we started from, so the routes stay 13
 * pixels long and nothing is gained.
 *
 * So a round frames ONE route - the one it selected - and the rest are one
 * click away. A single 60 km route across a padded viewport is unmistakable,
 * and `Fit all routes` is still there for the national spread when that is
 * the thing being shown.
 * ------------------------------------------------------------------ */

export type LatLng = readonly [number, number];
/** [[south, west], [north, east]] - the order Leaflet's fitBounds expects. */
export type Bounds = readonly [LatLng, LatLng];

/**
 * A point we are willing to send a map to.
 *
 * A lot with a missing or corrupt coordinate must not drag the viewport into
 * the Atlantic - and `fitBounds` with a NaN in it throws inside Leaflet,
 * which would take the whole screen down on the one click the demo needs.
 */
const usable = (p: LatLng): boolean =>
  Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

/**
 * Never hand Leaflet a box with no size.
 *
 * A lot sitting on top of its unit - or a single point - gives a zero-span
 * bounds, and fitBounds then zooms to the maximum the tiles allow: a demo
 * that lands in somebody's field at street level. Roughly 2 km of padding
 * keeps the fit sane and is far smaller than any real route, so it changes
 * nothing for the normal case.
 */
const MIN_SPAN_DEG = 0.02;

const padded = ([[s, w], [n, e]]: Bounds): Bounds => {
  const growLat = Math.max(0, MIN_SPAN_DEG - (n - s)) / 2;
  const growLon = Math.max(0, MIN_SPAN_DEG - (e - w)) / 2;
  return [
    [s - growLat, w - growLon],
    [n + growLat, e + growLon],
  ];
};

/** The smallest box containing every usable point, or null when there are none. */
export const boundsOf = (points: readonly LatLng[]): Bounds | null => {
  const points_ = points.filter(usable);
  if (points_.length === 0) return null;

  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;
  for (const [lat, lon] of points_) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return padded([
    [south, west],
    [north, east],
  ]);
};

/** One route: the lot at one end, the unit at the other. */
export const routeBounds = (from: LatLng, to: LatLng): Bounds | null => boundsOf([from, to]);

/**
 * Every route a round drew. Null when the round placed nothing - which is a
 * real outcome, not an error, and must never reach fitBounds.
 */
export const allRouteBounds = (lines: readonly { from: LatLng; to: LatLng }[]): Bounds | null =>
  boundsOf(lines.flatMap((l) => [l.from, l.to]));

/**
 * How much ground a framing actually covers, corner to corner.
 *
 * Exported because it is the number that decided the design: a framing of
 * ~2,500 km is the country, and re-framing the country as the country is not
 * a fix. Keeps that reasoning checkable rather than remembered.
 */
export const spanKm = ([[s, w], [n, e]]: Bounds): number =>
  haversineKm({ lat: s, lon: w }, { lat: n, lon: e });

/**
 * A stable identity for a framing, so the view refits when the target moves
 * and stays put when React merely re-renders. Rounded: a repaint that changes
 * a coordinate in the twelfth decimal place is not a new place to look.
 */
export const framingKey = (bounds: Bounds | null): string =>
  bounds === null ? "" : bounds.flat().map((n) => n.toFixed(4)).join(",");
