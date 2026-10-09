export function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

/** Renders rows as a left-aligned, fixed-width text table with a header separator. */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => (row[col] ?? "").length)),
  );

  const renderRow = (cells: string[]): string =>
    cells.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join("  ");

  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  return [renderRow(headers), separator, ...rows.map((row) => renderRow(row))].join("\n");
}
