import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { InventoryEditor, type EditorRow } from "./inventory-editor";

const ROW_CAP = 5000;

export default async function InventoryEditorPage() {
  const supabase = await createClient();
  await getMyStore(supabase);

  const { data, error } = await supabase
    .from("inventory_items")
    .select(
      "id, quantity, condition, price_cents, cost_cents, notes, status, updated_at, cards!inner(name, sets(name))",
    )
    .order("created_at", { ascending: false })
    .order("id")
    .limit(ROW_CAP);

  if (error) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-xl font-semibold text-foreground">Inventory Editor</h1>
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Could not load inventory: {error.message}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-foreground">Inventory Editor</h1>
      <InventoryEditor items={(data ?? []) as unknown as EditorRow[]} />
    </main>
  );
}
