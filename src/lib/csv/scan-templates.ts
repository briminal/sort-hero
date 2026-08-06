import type { ExportColumn, ExportTemplate } from "./templates";

// Separate from ExportRow (which is DB-shaped, used by the server-side
// export routes) -- Scan Station export runs entirely client-side against
// the in-memory review queue, before anything is committed to inventory,
// so the row shape is scan-specific (original filename, confidence, both
// price bases) rather than a DB row.
export type ScanExportRow = {
  cardName: string;
  setName: string | null;
  collectorNumber: string | null;
  rarity: string | null;
  condition: string;
  printing: string;
  language: string;
  quantity: number;
  marketPriceCents: number | null;
  lowPriceCents: number | null;
  costCents: number | null;
  confidence: number | null;
  fileName: string;
  notes: string;
};

function priceDollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

export const scanExportTemplates: Record<string, ExportTemplate<ScanExportRow>> = {
  sorthero: {
    id: "sorthero",
    label: "Sort Hero",
    columns: [
      { key: "cardName", header: "Card Name", get: (r) => r.cardName },
      { key: "setName", header: "Set", get: (r) => r.setName ?? "" },
      { key: "collectorNumber", header: "Number", get: (r) => r.collectorNumber ?? "" },
      { key: "rarity", header: "Rarity", get: (r) => r.rarity ?? "" },
      { key: "condition", header: "Condition", get: (r) => r.condition },
      { key: "printing", header: "Printing", get: (r) => r.printing },
      { key: "language", header: "Language", get: (r) => r.language },
      { key: "quantity", header: "Quantity", get: (r) => String(r.quantity) },
      { key: "marketPriceCents", header: "Market Price", get: (r) => priceDollars(r.marketPriceCents) },
      { key: "lowPriceCents", header: "Low Price", get: (r) => priceDollars(r.lowPriceCents) },
      { key: "costCents", header: "Cost", get: (r) => priceDollars(r.costCents) },
      { key: "confidence", header: "Confidence %", get: (r) => (r.confidence === null ? "" : String(Math.round(r.confidence * 100))) },
      { key: "fileName", header: "Original File", get: (r) => r.fileName },
      { key: "notes", header: "Notes", get: (r) => r.notes },
    ],
  },
  quicklist: {
    id: "quicklist",
    label: "TCGplayer Quicklist",
    columns: [
      { key: "cardName", header: "Product Name", get: (r) => r.cardName },
      { key: "setName", header: "Set Name", get: (r) => r.setName ?? "" },
      { key: "quantity", header: "Quantity", get: (r) => String(r.quantity) },
    ],
  },
  tcgplayer: {
    id: "tcgplayer",
    label: "TCGplayer bulk upload",
    columns: [
      { key: "cardName", header: "Product Name", get: (r) => r.cardName },
      { key: "setName", header: "Set Name", get: (r) => r.setName ?? "" },
      { key: "collectorNumber", header: "Number", get: (r) => r.collectorNumber ?? "" },
      { key: "rarity", header: "Rarity", get: (r) => r.rarity ?? "" },
      { key: "condition", header: "Condition", get: (r) => r.condition },
      { key: "marketPriceCents", header: "TCG Marketplace Price", get: (r) => priceDollars(r.marketPriceCents) },
      { key: "quantity", header: "Add to Quantity", get: (r) => String(r.quantity) },
    ],
  },
};

export const SCAN_EXPORT_ALL_FIELDS: ExportColumn<ScanExportRow>[] = scanExportTemplates.sorthero!.columns;
