import { describe, it, expect } from "vitest";
import {
  allRouteBounds,
  boundsOf,
  framingKey,
  routeBounds,
  spanKm,
  type Bounds,
  type LatLng,
} from "./fit.ts";

/* ------------------------------------------------------------------ *
 * The map opens on India, and at zoom 5 a 60 km route is about 13 pixels.
 * These tests cover the geometry that decides where to look after a round -
 * and, more importantly, the cases where there is nothing to look at.
 *
 * `fitBounds` with an empty set or a NaN throws inside Leaflet. That would
 * take the whole Operator screen down on `Run matching`, which is the one
 * click the demo is built around, so every one of those paths returns null
 * here rather than a bounds the view could pass on.
 * ------------------------------------------------------------------ */

const LUDHIANA: LatLng = [30.9, 75.86];
const AMRITSAR: LatLng = [31.63, 74.87];
const MADURAI: LatLng = [9.93, 78.12];

describe("a round that placed nothing", () => {
  /* THE BAR, stated in the issue: zero matches must not fit an empty set and
     must not fling the map somewhere meaningless. Null is how this module
     says "there is nowhere to look", and the view never calls fitBounds. */
  it("has nowhere to look, and says so", () => {
    expect(allRouteBounds([])).toBeNull();
    expect(boundsOf([])).toBeNull();
  });

  it("says so for a route whose endpoints never loaded", () => {
    expect(boundsOf([[Number.NaN, Number.NaN]])).toBeNull();
    expect(routeBounds([Number.NaN, 75], [30.9, Number.NaN])).toBeNull();
  });

  /* A single corrupt lot must not drag the viewport off the planet, and it
     must not cost us the routes that are fine. */
  it("ignores an unusable point without losing the usable ones", () => {
    const bounds = boundsOf([LUDHIANA, [Number.POSITIVE_INFINITY, 0], AMRITSAR, [999, 999]]);
    expect(bounds).not.toBeNull();
    const [[south, west], [north, east]] = bounds!;
    expect(south).toBeCloseTo(30.9, 1);
    expect(north).toBeCloseTo(31.63, 1);
    expect(west).toBeCloseTo(74.87, 1);
    expect(east).toBeCloseTo(75.86, 1);
  });
});

describe("framing one route", () => {
  it("boxes both ends, in the order Leaflet expects", () => {
    const [[south, west], [north, east]] = routeBounds(AMRITSAR, LUDHIANA)!;
    // south <= north and west <= east, whichever end was given first.
    expect(south).toBeLessThan(north);
    expect(west).toBeLessThan(east);
  });

  it("does not care which end is given first", () => {
    expect(routeBounds(AMRITSAR, LUDHIANA)).toEqual(routeBounds(LUDHIANA, AMRITSAR));
  });

  /* A lot sitting on its unit gives a zero-span box, and fitBounds then zooms
     to whatever the tiles allow - a demo that lands in somebody's field at
     street level. The pad is ~2 km, far smaller than any real route. */
  it("never hands back a box with no size", () => {
    const [[south, west], [north, east]] = routeBounds(LUDHIANA, LUDHIANA)!;
    expect(north - south).toBeGreaterThan(0);
    expect(east - west).toBeGreaterThan(0);
    expect(spanKm([[south, west], [north, east]])).toBeLessThan(5);
  });

  it("leaves a real route alone", () => {
    // ~72 km apart: the pad must not be visible at this scale.
    const km = spanKm(routeBounds(AMRITSAR, LUDHIANA)!);
    expect(km).toBeGreaterThan(60);
    expect(km).toBeLessThan(130);
  });
});

describe("framing every route", () => {
  const lines = [
    { from: AMRITSAR, to: LUDHIANA },
    { from: MADURAI, to: [10.8, 78.7] as LatLng },
  ];

  it("covers every end of every route", () => {
    const [[south, west], [north, east]] = allRouteBounds(lines)!;
    expect(south).toBeLessThanOrEqual(9.93);
    expect(north).toBeGreaterThanOrEqual(31.63);
    expect(west).toBeLessThanOrEqual(74.87);
    expect(east).toBeGreaterThanOrEqual(78.7);
  });

  /* THE MEASUREMENT THAT SHAPED THE FIX.

     On the deployed host a round's matched lots span lat 9.91-31.88 and
     lon 73.52-85.22. Fitting to all of them is fitting to the country, so
     the routes stay 13 pixels long and the "fix" changes nothing. This pins
     that reasoning so it stays checkable rather than remembered - if the
     data ever clusters, this test says so by failing. */
  it("spans the country on real data, which is why a round frames one route", () => {
    const live = allRouteBounds([
      { from: [31.88, 74.5], to: [31.63, 74.87] },
      { from: [9.91, 78.1], to: [10.2, 77.9] },
      { from: [25.4, 85.22], to: [25.6, 85.0] },
      { from: [28.1, 73.52], to: [28.3, 73.9] },
    ])!;
    expect(spanKm(live)).toBeGreaterThan(2000);
  });

  it("is null when a round placed nothing", () => {
    expect(allRouteBounds([])).toBeNull();
  });
});

describe("knowing when to move the map", () => {
  /* The view refits when the key changes. It must change when the target
     moves and stay put when React merely re-renders, or the map lurches on
     every repaint. */
  it("is the same for the same framing, rebuilt", () => {
    expect(framingKey(routeBounds(AMRITSAR, LUDHIANA))).toBe(
      framingKey(routeBounds(AMRITSAR, LUDHIANA)),
    );
  });

  it("differs for a different framing", () => {
    expect(framingKey(routeBounds(AMRITSAR, LUDHIANA))).not.toBe(
      framingKey(routeBounds(MADURAI, LUDHIANA)),
    );
  });

  /* Nowhere to look has to be distinguishable from somewhere, or a round that
     placed nothing would look like a framing the view had already applied. */
  it("is empty when there is nowhere to look", () => {
    expect(framingKey(null)).toBe("");
    expect(framingKey(routeBounds(AMRITSAR, LUDHIANA))).not.toBe("");
  });

  /* A coordinate that wobbles in the twelfth decimal place is not a new place
     to look, and refitting on it would fight the user panning the map. */
  it("does not change for a wobble below the metre", () => {
    const a = routeBounds([30.9, 75.86], AMRITSAR);
    const b = routeBounds([30.900000004, 75.860000007], AMRITSAR);
    expect(framingKey(a)).toBe(framingKey(b));
  });
});

describe("spanKm", () => {
  it("measures the diagonal, not one edge", () => {
    const box: Bounds = [
      [30, 75],
      [31, 76],
    ];
    // ~111 km north and ~95 km east: the diagonal is longer than either.
    expect(spanKm(box)).toBeGreaterThan(140);
  });

  it("is ~0 for a point", () => {
    expect(
      spanKm([
        [30.9, 75.86],
        [30.9, 75.86],
      ]),
    ).toBeCloseTo(0, 5);
  });
});
