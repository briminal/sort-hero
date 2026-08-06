export type ExportRow = {
  id: string;
  quantity: number;
  condition: string;
  price_cents: number | null;
  notes: string | null;
  status: string;
  card_name: string;
  set_name: string | null;
  collector_number: string | null;
  rarity: string | null;
  game_code: string | null;
  image_url: string | null;
};

export type ExportColumn<T = ExportRow> = { key: string; header: string; get: (row: T) => string };

export type ExportTemplate<T = ExportRow> = {
  id: string;
  label: string;
  columns: ExportColumn<T>[];
};

function priceDollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

// Approximations of each platform's publicly-known bulk-upload columns --
// not verified against official current specs (several have no public
// formal spec), same caveat as the original 3 templates.
export const exportTemplates: Record<string, ExportTemplate> = {
  generic: {
    id: "generic",
    label: "Generic (all fields)",
    columns: [
      { key: "id", header: "id", get: (r) => r.id },
      { key: "card_name", header: "card_name", get: (r) => r.card_name },
      { key: "set_name", header: "set_name", get: (r) => r.set_name ?? "" },
      { key: "game_code", header: "game", get: (r) => r.game_code ?? "" },
      { key: "condition", header: "condition", get: (r) => r.condition },
      { key: "quantity", header: "quantity", get: (r) => String(r.quantity) },
      { key: "price_cents", header: "price", get: (r) => priceDollars(r.price_cents) },
      { key: "status", header: "status", get: (r) => r.status },
      { key: "notes", header: "notes", get: (r) => r.notes ?? "" },
      { key: "image_url", header: "image_url", get: (r) => r.image_url ?? "" },
    ],
  },
  tcgplayer: {
    id: "tcgplayer",
    label: "TCGplayer bulk upload",
    columns: [
      { key: "card_name", header: "Product Name", get: (r) => r.card_name },
      { key: "set_name", header: "Set Name", get: (r) => r.set_name ?? "" },
      { key: "collector_number", header: "Number", get: (r) => r.collector_number ?? "" },
      { key: "rarity", header: "Rarity", get: (r) => r.rarity ?? "" },
      { key: "condition", header: "Condition", get: (r) => r.condition },
      { key: "price_cents", header: "TCG Marketplace Price", get: (r) => priceDollars(r.price_cents) },
      { key: "quantity", header: "Add to Quantity", get: (r) => String(r.quantity) },
    ],
  },
  quicklist: {
    id: "quicklist",
    label: "TCGplayer Quicklist",
    columns: [
      { key: "card_name", header: "Product Name", get: (r) => r.card_name },
      { key: "set_name", header: "Set Name", get: (r) => r.set_name ?? "" },
      { key: "quantity", header: "Quantity", get: (r) => String(r.quantity) },
    ],
  },
  binderpos: {
    id: "binderpos",
    label: "BinderPOS",
    columns: [
      { key: "card_name", header: "Product Name", get: (r) => r.card_name },
      { key: "set_name", header: "Set", get: (r) => r.set_name ?? "" },
      { key: "collector_number", header: "Number", get: (r) => r.collector_number ?? "" },
      { key: "condition", header: "Condition", get: (r) => r.condition },
      { key: "rarity", header: "Rarity", get: (r) => r.rarity ?? "" },
      { key: "price_cents", header: "Price", get: (r) => priceDollars(r.price_cents) },
      { key: "quantity", header: "Quantity", get: (r) => String(r.quantity) },
    ],
  },
  manapool: {
    id: "manapool",
    label: "Manapool",
    columns: [
      { key: "card_name", header: "Name", get: (r) => r.card_name },
      { key: "set_name", header: "Set Code", get: (r) => r.set_name ?? "" },
      { key: "collector_number", header: "Collector Number", get: (r) => r.collector_number ?? "" },
      { key: "condition", header: "Condition", get: (r) => r.condition },
      { key: "quantity", header: "Quantity", get: (r) => String(r.quantity) },
      { key: "price_cents", header: "Price", get: (r) => priceDollars(r.price_cents) },
    ],
  },
  cardtrader: {
    id: "cardtrader",
    label: "Cardtrader",
    columns: [
      { key: "card_name", header: "Name", get: (r) => r.card_name },
      { key: "set_name", header: "Set", get: (r) => r.set_name ?? "" },
      { key: "condition", header: "Condition", get: (r) => r.condition },
      { key: "quantity", header: "Quantity", get: (r) => String(r.quantity) },
      { key: "price_cents", header: "Price", get: (r) => priceDollars(r.price_cents) },
    ],
  },
  shopify: {
    id: "shopify",
    label: "Shopify product CSV",
    columns: [
      { key: "id", header: "Handle", get: (r) => r.id },
      {
        key: "title",
        header: "Title",
        get: (r) => `${r.card_name}${r.set_name ? ` - ${r.set_name}` : ""}`,
      },
      { key: "price_cents", header: "Variant Price", get: (r) => priceDollars(r.price_cents) },
      { key: "quantity", header: "Variant Inventory Qty", get: (r) => String(r.quantity) },
      { key: "id_sku", header: "Variant SKU", get: (r) => r.id },
      { key: "image_url", header: "Image Src", get: (r) => r.image_url ?? "" },
    ],
  },
};

// Union of every field used across templates, for the custom-columns picker.
export const ALL_FIELDS: ExportColumn[] = [
  { key: "id", header: "id", get: (r) => r.id },
  { key: "card_name", header: "card_name", get: (r) => r.card_name },
  { key: "set_name", header: "set_name", get: (r) => r.set_name ?? "" },
  { key: "game_code", header: "game", get: (r) => r.game_code ?? "" },
  { key: "collector_number", header: "collector_number", get: (r) => r.collector_number ?? "" },
  { key: "rarity", header: "rarity", get: (r) => r.rarity ?? "" },
  { key: "condition", header: "condition", get: (r) => r.condition },
  { key: "quantity", header: "quantity", get: (r) => String(r.quantity) },
  { key: "price_cents", header: "price", get: (r) => priceDollars(r.price_cents) },
  { key: "status", header: "status", get: (r) => r.status },
  { key: "notes", header: "notes", get: (r) => r.notes ?? "" },
  { key: "image_url", header: "image_url", get: (r) => r.image_url ?? "" },
];

export function buildCustomTemplate(fieldKeys: string[]): ExportTemplate {
  const columns = ALL_FIELDS.filter((f) => fieldKeys.includes(f.key));
  return { id: "custom", label: "Custom columns", columns };
}

/** Resolves a fixed template by id, or a custom column set from a
 * comma-separated `fields` param -- shared by both export routes. */
export function resolveTemplate(
  templateId: string | null,
  fieldsParam: string | null,
): ExportTemplate | null {
  if (fieldsParam) {
    const template = buildCustomTemplate(fieldsParam.split(",").map((f) => f.trim()));
    return template.columns.length > 0 ? template : null;
  }

  return exportTemplates[templateId ?? "generic"] ?? null;
}

// Reports has an unrelated row shape (sales line items, not inventory) --
// a separate small parallel type/template rather than forcing it into the
// inventory-shaped ExportRow machinery above.
export type ReportsExportRow = {
  created_at: string;
  source_type: string;
  card_name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  unit_cost_cents: number | null;
  margin_cents: number | null;
};

export const reportsExportTemplate: ExportTemplate<ReportsExportRow> = {
  id: "sales_line_items",
  label: "Sales line items",
  columns: [
    { key: "created_at", header: "date", get: (r) => r.created_at },
    { key: "source_type", header: "channel", get: (r) => r.source_type },
    { key: "card_name", header: "card_name", get: (r) => r.card_name },
    { key: "quantity", header: "quantity", get: (r) => String(r.quantity) },
    { key: "unit_price_cents", header: "unit_price", get: (r) => priceDollars(r.unit_price_cents) },
    { key: "line_total_cents", header: "revenue", get: (r) => priceDollars(r.line_total_cents) },
    { key: "unit_cost_cents", header: "unit_cost", get: (r) => priceDollars(r.unit_cost_cents) },
    {
      key: "margin_cents",
      header: "margin",
      get: (r) => (r.margin_cents === null ? "unknown" : priceDollars(r.margin_cents)),
    },
  ],
};
