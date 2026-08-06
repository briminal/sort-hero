import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { TillList, type TillRow } from "./till-list";

export default async function TillsPage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const { data, error } = await supabase
    .from("tills")
    .select("id, name, status, opening_cash_cents, closing_cash_cents, opened_at, closed_at")
    .eq("store_id", storeId)
    .order("opened_at", { ascending: false });

  if (error) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-xl font-semibold text-foreground">Tills</h1>
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Could not load tills: {error.message}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-foreground">Tills</h1>
      <TillList storeId={storeId} initialTills={(data ?? []) as TillRow[]} />
    </main>
  );
}
