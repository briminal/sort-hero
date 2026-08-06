import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { ReturnsForm, type OrderWithItems } from "./returns-form";

export default async function ReturnsPage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, total_cents, status, created_at, order_items(id, inventory_item_id, card_name, quantity, unit_price_cents)",
    )
    .eq("store_id", storeId)
    .in("status", ["completed", "partially_refunded"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-xl font-semibold text-foreground">Returns</h1>
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Could not load orders: {error.message}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-foreground">Returns</h1>
      <ReturnsForm orders={(data ?? []) as unknown as OrderWithItems[]} />
    </main>
  );
}
