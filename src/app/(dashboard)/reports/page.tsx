import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { resolveDateRange } from "@/lib/reports/date-range";
import {
  computeMarginSummary,
  revenueByDay,
  topSellersByQuantity,
  topSellersByRevenue,
  type SalesLineItemRow,
} from "@/lib/reports/aggregate";
import { computeInventoryAnalytics, type InventoryAnalyticsRow } from "@/lib/reports/inventory-analytics";
import { DateRangePicker } from "./date-range-picker";
import { RevenueChart } from "./revenue-chart";
import { TopSellersTable } from "./top-sellers-table";
import { MarginSummaryPanel } from "./margin-summary";
import { InventoryAnalyticsSummary } from "./inventory-analytics-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const SALE_STATUSES = ["completed", "refunded", "partially_refunded", "fulfilled"];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; tz?: string }>;
}) {
  const params = await searchParams;
  const range = resolveDateRange({ range: params.range, from: params.from, to: params.to, timeZone: params.tz });

  const supabase = await createClient();
  await getMyStore(supabase);

  const { data: salesData, error: salesError } = await supabase
    .from("sales_line_items")
    .select(
      "id, source_type, platform, card_id, card_name, quantity, unit_price_cents, line_total_cents, unit_cost_cents, created_at, order_status",
    )
    .gte("created_at", range.from)
    .lte("created_at", range.to)
    .in("order_status", SALE_STATUSES)
    .order("created_at", { ascending: true })
    .limit(20000);

  const salesRows = (salesData ?? []) as unknown as SalesLineItemRow[];

  const { data: inventoryData, error: inventoryError } = await supabase
    .from("inventory_items")
    .select("quantity, price_cents, cost_cents, condition, status, cards!inner(games(code))")
    .limit(5000);

  const inventoryRows = ((inventoryData ?? []) as unknown as {
    quantity: number;
    price_cents: number | null;
    cost_cents: number | null;
    condition: string;
    status: string;
    cards: { games: { code: string } | null };
  }[]).map(
    (row): InventoryAnalyticsRow => ({
      quantity: row.quantity,
      price_cents: row.price_cents,
      cost_cents: row.cost_cents,
      condition: row.condition,
      status: row.status,
      game_code: row.cards.games?.code ?? null,
    }),
  );

  const revenuePoints = revenueByDay(salesRows);
  const marginSummary = computeMarginSummary(salesRows);
  const inventoryAnalytics = computeInventoryAnalytics(inventoryRows);

  // Pass through the raw query params (not the already-resolved range) so
  // the export route re-derives the exact same range via resolveDateRange
  // itself -- for a custom range, resolveDateRange expects bare YYYY-MM-DD
  // values, not the fully-resolved ISO instants in `range.from`/`range.to`.
  const exportParams = new URLSearchParams();
  exportParams.set("range", params.range ?? range.preset);
  if (params.from) exportParams.set("from", params.from);
  if (params.to) exportParams.set("to", params.to);
  if (params.tz) exportParams.set("tz", params.tz);

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Reports</h1>
        <Button variant="outline" asChild>
          <a href={`/api/reports/export?${exportParams.toString()}`}>Export CSV</a>
        </Button>
      </div>

      <DateRangePicker preset={range.preset} from={range.from} to={range.to} />

      {(salesError || inventoryError) && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {salesError?.message ?? inventoryError?.message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <MarginSummaryPanel summary={marginSummary} />
          <div className="mt-4">
            <RevenueChart points={revenuePoints} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid grid-cols-1 gap-6 pt-4 sm:grid-cols-2">
          <TopSellersTable title="Top sellers by revenue" rows={topSellersByRevenue(salesRows)} />
          <TopSellersTable title="Top sellers by quantity" rows={topSellersByQuantity(salesRows)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inventory analytics</CardTitle>
        </CardHeader>
        <CardContent>
          <InventoryAnalyticsSummary analytics={inventoryAnalytics} />
        </CardContent>
      </Card>
    </main>
  );
}
