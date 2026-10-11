/** Fixed-order categorical hues, light/dark steps. Order is the CVD-safety mechanism — never cycle or re-sort. */
export const CATEGORICAL: Array<{ light: string; dark: string }> = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#6250d6", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];

export const STATUS = {
  good: { light: "#0ca30c", dark: "#0ca30c" },
  warning: { light: "#fab219", dark: "#fab219" },
  critical: { light: "#d03b3b", dark: "#d03b3b" },
};

/** Stable hue assignment for a categorical key: same key always gets the same slot within one chart render. */
export function categoricalSlot(index: number): { light: string; dark: string } {
  return CATEGORICAL[index % CATEGORICAL.length]!;
}
