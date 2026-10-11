import { describe, expect, it } from "vitest";
import { barWidthPercent, linearScale, pointScale } from "./scale.js";

describe("linearScale", () => {
  it("maps a domain value proportionally into the pixel range", () => {
    const scale = linearScale([0, 10], [0, 100]);
    expect(scale(5)).toBe(50);
    expect(scale(0)).toBe(0);
    expect(scale(10)).toBe(100);
  });

  it("clamps out-of-domain values to the range edges", () => {
    const scale = linearScale([0, 10], [0, 100]);
    expect(scale(-5)).toBe(0);
    expect(scale(50)).toBe(100);
  });

  it("collapses to the range start when the domain has zero span", () => {
    const scale = linearScale([5, 5], [0, 100]);
    expect(scale(5)).toBe(0);
  });
});

describe("pointScale", () => {
  it("spaces points evenly across the range", () => {
    const scale = pointScale(5, [0, 100]);
    expect(scale(0)).toBe(0);
    expect(scale(4)).toBe(100);
    expect(scale(2)).toBe(50);
  });

  it("centers a single point", () => {
    const scale = pointScale(1, [0, 100]);
    expect(scale(0)).toBe(50);
  });
});

describe("barWidthPercent", () => {
  it("scales a value relative to the chart's max", () => {
    expect(barWidthPercent(5, 10)).toBe(50);
    expect(barWidthPercent(10, 10)).toBe(100);
  });

  it("returns 0 when the max is zero or negative", () => {
    expect(barWidthPercent(5, 0)).toBe(0);
  });
});
