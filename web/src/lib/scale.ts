/** Linear interpolation from a numeric domain to a pixel range, clamped so out-of-range values don't escape the chart area. */
export function linearScale(domain: [number, number], range: [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => r0;
  return (value: number) => {
    const t = Math.max(0, Math.min(1, (value - d0) / span));
    return r0 + t * (r1 - r0);
  };
}

/** Evenly-spaced point positions for `count` discrete items across a pixel range, e.g. one x per day on a timeline. */
export function pointScale(count: number, range: [number, number]): (index: number) => number {
  const [r0, r1] = range;
  if (count <= 1) return () => (r0 + r1) / 2;
  const step = (r1 - r0) / (count - 1);
  return (index: number) => r0 + step * index;
}

/** Percent width (0-100) of a bar relative to the largest value in its chart, so the longest bar always fills the track. */
export function barWidthPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
