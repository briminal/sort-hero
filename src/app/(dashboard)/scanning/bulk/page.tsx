import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { getActiveGamesQuery } from "@/lib/games";
import { BulkScanner } from "./bulk-scanner";

export default async function BulkScanningPage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const { data: store } = await supabase
    .from("stores")
    .select("high_value_threshold_cents")
    .eq("id", storeId)
    .single();

  const games = await getActiveGamesQuery(supabase);

  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-semibold">Bulk Intake</h1>
      <BulkScanner initialThresholdCents={store?.high_value_threshold_cents ?? 2000} games={games} />
    </main>
  );
}
