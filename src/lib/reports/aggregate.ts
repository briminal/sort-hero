export function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export type SalesLineItemRow = {
  id: string;
  source_type: "pos" | "marketplace";
  platform: string | null;
  card_id: string;
  card_name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  unit_cost_cents: number | null;
  created_at: string;
  order_status: string;
};

export type RevenuePoint = { date: string; posRevenueCents: number; marketplaceRevenueCents: number };

/** Buckets line items by calendar day (UTC date portion of created_at) for
 * the revenue-over-time chart -- both channels stay on the same dollar
 * axis, never split into separate charts/axes. */
export function revenueByDay(rows: SalesLineItemRow[]): RevenuePoint[] {
  const byDate = new Map<string, RevenuePoint>();

  for (const row of rows) {
    const date = row.created_at.slice(0, 10);
    const point = byDate.get(date) ?? { date, posRevenueCents: 0, marketplaceRevenueCents: 0 };
    if (row.source_type === "pos") point.posRevenueCents += row.line_total_cents;
    else point.marketplaceRevenueCents += row.line_total_cents;
    byDate.set(date, point);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type TopSellerRow = {
  cardId: string;
  cardName: string;
  quantity: number;
  revenueCents: number;
};

export function topSellersByRevenue(rows: SalesLineItemRow[], limit = 10): TopSellerRow[] {
  const byCard = new Map<string, TopSellerRow>();

  for (const row of rows) {
    const entry = byCard.get(row.card_id) ?? {
      cardId: row.card_id,
      cardName: row.card_name,
      quantity: 0,
      revenueCents: 0,
    };
    entry.quantity += row.quantity;
    entry.revenueCents += row.line_total_cents;
    byCard.set(row.card_id, entry);
  }

  return [...byCard.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, limit);
}

export function topSellersByQuantity(rows: SalesLineItemRow[], limit = 10): TopSellerRow[] {
  const byCard = new Map<string, TopSellerRow>();

  for (const row of rows) {
    const entry = byCard.get(row.card_id) ?? {
      cardId: row.card_id,
      cardName: row.card_name,
      quantity: 0,
      revenueCents: 0,
    };
    entry.quantity += row.quantity;
    entry.revenueCents += row.line_total_cents;
    byCard.set(row.card_id, entry);
  }

  return [...byCard.values()].sort((a, b) => b.quantity - a.quantity).slice(0, limit);
}

export type MarginSummary = {
  revenueCents: number;
  knownCostCents: number;
  marginCents: number;
  unknownCostRevenueCents: number;
  unknownCostLineCount: number;
};

/** Margin only ever sums line items with a known unit_cost_cents -- a null
 * cost is "unknown," never treated as zero, since that would silently
 * overstate margin. Revenue from unknown-cost lines is reported separately
 * so the summary is honest about what it couldn't compute. */
export function computeMarginSummary(rows: SalesLineItemRow[]): MarginSummary {
  let revenueCents = 0;
  let knownCostCents = 0;
  let unknownCostRevenueCents = 0;
  let unknownCostLineCount = 0;

  for (const row of rows) {
    revenueCents += row.line_total_cents;
    if (row.unit_cost_cents === null) {
      unknownCostRevenueCents += row.line_total_cents;
      unknownCostLineCount++;
    } else {
      knownCostCents += row.unit_cost_cents * row.quantity;
    }
  }

  return {
    revenueCents,
    knownCostCents,
    marginCents: revenueCents - unknownCostRevenueCents - knownCostCents,
    unknownCostRevenueCents,
    unknownCostLineCount,
  };
}
