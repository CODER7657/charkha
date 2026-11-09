import { describe, expect, it } from "vitest";
import { MIN_SPAN_DEG, routeBounds } from "./fit.ts";

describe("routeBounds", () => {
  it("is null when the round placed nothing", () => {
    expect(routeBounds([])).toBeNull();
  });

  it("covers every route end, and only the round's routes", () => {
    const b = routeBounds([
      { from: [30.9, 74.6], to: [31.2, 75.1] }, // Ferozepur belt
      { from: [29.4, 76.9], to: [29.7, 77.2] },
    ]);
    expect(b).toEqual([
      [29.4, 74.6],
      [31.2, 77.2],
    ]);
  });

  it("never zooms to a street for a single short route", () => {
    const [[s, w], [n, e]] = routeBounds([{ from: [30.0, 75.0], to: [30.01, 75.01] }])!;
    expect(n - s).toBeCloseTo(MIN_SPAN_DEG);
    expect(e - w).toBeCloseTo(MIN_SPAN_DEG);
    expect((n + s) / 2).toBeCloseTo(30.005);
  });

  it("ignores a point that is not a number instead of producing NaN bounds", () => {
    const b = routeBounds([
      { from: [Number.NaN, 75], to: [30, 75] },
      { from: [31, 76], to: [31, 76.5] },
    ]);
    expect(b?.flat().every(Number.isFinite)).toBe(true);
  });
});
