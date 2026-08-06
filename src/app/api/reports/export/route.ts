import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCsv } from "@/lib/csv/export";
import { reportsExportTemplate, type ReportsExportRow } from "@/lib/csv/templates";
import { resolveDateRange } from "@/lib/reports/date-range";

const SALE_STATUSES = ["completed", "refunded", "partially_refunded", "fulfilled"];

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const range = resolveDateRange({
    range: searchParams.get("range") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    timeZone: searchParams.get("tz") ?? undefined,
  });
  const sourceType = searchParams.get("source_type");

  let query = supabase
    .from("sales_line_items")
    .select("created_at, source_type, card_name, quantity, unit_price_cents, line_total_cents, unit_cost_cents, order_status")
    .gte("created_at", range.from)
    .lte("created_at", range.to)
    .in("order_status", SALE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (sourceType) query = query.eq("source_type", sourceType);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    created_at: string;
    source_type: string;
    card_name: string;
    quantity: number;
    unit_price_cents: number;
    line_total_cents: number;
    unit_cost_cents: number | null;
  };

  const rows: ReportsExportRow[] = ((data ?? []) as Row[]).map((r) => ({
    created_at: r.created_at,
    source_type: r.source_type,
    card_name: r.card_name,
    quantity: r.quantity,
    unit_price_cents: r.unit_price_cents,
    line_total_cents: r.line_total_cents,
    unit_cost_cents: r.unit_cost_cents,
    margin_cents: r.unit_cost_cents === null ? null : r.line_total_cents - r.unit_cost_cents * r.quantity,
  }));

  const csv = buildCsv(reportsExportTemplate, rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-line-items.csv"`,
    },
  });
}
