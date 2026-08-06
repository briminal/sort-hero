export type InventoryAnalyticsRow = {
  quantity: number;
  price_cents: number | null;
  cost_cents: number | null;
  condition: string;
  status: string;
  game_code: string | null;
};

export type Breakdown = { key: string; quantity: number; retailValueCents: number };

export type InventoryAnalytics = {
  totalQuantity: number;
  retailValueCents: number;
  costValueCents: number;
  unknownCostQuantity: number;
  byStatus: Breakdown[];
  byCondition: Breakdown[];
  byGame: Breakdown[];
};

function bucketBy(rows: InventoryAnalyticsRow[], key: (r: InventoryAnalyticsRow) => string): Breakdown[] {
  const map = new Map<string, Breakdown>();
  for (const row of rows) {
    const k = key(row);
    const entry = map.get(k) ?? { key: k, quantity: 0, retailValueCents: 0 };
    entry.quantity += row.quantity;
    entry.retailValueCents += (row.price_cents ?? 0) * row.quantity;
    map.set(k, entry);
  }
  return [...map.values()].sort((a, b) => b.quantity - a.quantity);
}

export function computeInventoryAnalytics(rows: InventoryAnalyticsRow[]): InventoryAnalytics {
  let totalQuantity = 0;
  let retailValueCents = 0;
  let costValueCents = 0;
  let unknownCostQuantity = 0;

  for (const row of rows) {
    totalQuantity += row.quantity;
    if (row.price_cents !== null) retailValueCents += row.price_cents * row.quantity;
    if (row.cost_cents !== null) costValueCents += row.cost_cents * row.quantity;
    else unknownCostQuantity += row.quantity;
  }

  return {
    totalQuantity,
    retailValueCents,
    costValueCents,
    unknownCostQuantity,
    byStatus: bucketBy(rows, (r) => r.status),
    byCondition: bucketBy(rows, (r) => r.condition),
    byGame: bucketBy(rows, (r) => r.game_code ?? "unknown"),
  };
}
