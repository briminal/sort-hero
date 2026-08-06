import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { LabelPurchase, type MarketplaceOrderDetail } from "./label-purchase";
import { PosInvoice, type PosOrderDetail } from "./pos-invoice";

function notFound(message: string) {
  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-semibold text-foreground">Order</h1>
      <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Could not load order: {message}
      </p>
    </main>
  );
}

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createClient();
  await getMyStore(supabase);

  // order_queue tells us which underlying table this id belongs to
  // (POS sale vs. marketplace order) -- source_type comes straight from the
  // view's UNION ALL tag, see the orders_shipping migration.
  const { data: queueRow } = await supabase.from("order_queue").select("source_type").eq("id", orderId).maybeSingle();
  if (!queueRow) return notFound("Not found");

  if (queueRow.source_type === "pos") {
    const { data: order, error } = await supabase
      .from("orders")
      .select(
        "id, status, subtotal_cents, discount_cents, tax_cents, tax_exempt, total_cents, created_at, tills(name), order_items(card_name, quantity, unit_price_cents, line_total_cents, taxable, deduct_inventory), payments(method, amount_cents, status, created_at), refunds(amount_cents, reason, created_at)",
      )
      .eq("id", orderId)
      .single();

    if (error || !order) return notFound(error?.message ?? "Not found");

    return (
      <main className="flex flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold text-foreground">Order (POS)</h1>
        <PosInvoice order={order as unknown as PosOrderDetail} />
      </main>
    );
  }

  const { data: order, error } = await supabase
    .from("marketplace_orders")
    .select(
      "id, platform, status, subtotal_cents, total_cents, customer_name, customer_email, shipping_address, created_at, marketplace_order_items(card_name, quantity, unit_price_cents, line_total_cents), shipments(id, tracking_number, tracking_url, label_url, carrier_name, service_level, status, tracking_push_error)",
    )
    .eq("id", orderId)
    .single();

  if (error || !order) return notFound(error?.message ?? "Not found");

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-foreground">Order ({order.platform})</h1>
      <LabelPurchase order={order as unknown as MarketplaceOrderDetail} />
    </main>
  );
}
