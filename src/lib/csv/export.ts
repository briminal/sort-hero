import Papa from "papaparse";
import type { ExportTemplate } from "./templates";

// A cell starting with =, +, -, or @ is interpreted as a formula by
// Excel/Sheets when the CSV is opened -- free-text fields like inventory
// notes (settable by staff, or by re-importing a supplier's CSV) could
// otherwise smuggle in a formula that executes on open. Prefixing with a
// single quote neutralizes it without changing the visible value for any
// normal cell (card names, prices, etc. never start with these characters).
function sanitizeCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function buildCsv<T>(template: ExportTemplate<T>, rows: T[]): string {
  const data = rows.map((row) => {
    const record: Record<string, string> = {};
    for (const col of template.columns) record[col.header] = sanitizeCell(col.get(row));
    return record;
  });

  return Papa.unparse({
    fields: template.columns.map((c) => c.header),
    data,
  });
}
