import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { InventoryList, type InventoryItemRow } from "./inventory-list";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; game?: string }>;
}) {
  const { q, status, game } = await searchParams;
  const supabase = await createClient();
  const { role } = await getMyStore(supabase);

  let query = supabase
    .from("inventory_items")
    .select(
      "id, quantity, condition, price_cents, notes, status, scanned_image_url, created_at, updated_at, cards!inner(id, name, image_url, rarity, collector_number, game_id, sets(name), games(code))",
    )
    .order("created_at", { ascending: false })
    .order("id")
    .limit(100);

  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("cards.name", `%${q}%`);

  if (game) {
    const { data: gameRow } = await supabase.from("games").select("id").eq("code", game).single();
    if (gameRow) query = query.eq("cards.game_id", gameRow.id as string);
  }

  const { data, error } = await query;

  if (error) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-xl font-semibold">Inventory</h1>
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Could not load inventory: {error.message}
        </p>
      </main>
    );
  }

  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-semibold">Inventory</h1>
      <InventoryList items={(data ?? []) as unknown as InventoryItemRow[]} isOwner={role === "owner"} />
    </main>
  );
}
