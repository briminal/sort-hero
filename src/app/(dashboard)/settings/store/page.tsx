import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { TaxSettingsForm } from "./tax-settings-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function StoreSettingsPage() {
  const supabase = await createClient();
  const { storeId, role } = await getMyStore(supabase);

  const { data: store } = await supabase
    .from("stores")
    .select("tax_rate_percent, round_to_nearest_cents")
    .eq("id", storeId)
    .single();

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-foreground">Store</h1>
      <Card>
        <CardHeader>
          <CardTitle>Tax &amp; Rounding</CardTitle>
        </CardHeader>
        <CardContent>
          <TaxSettingsForm
            initialTaxRatePercent={Number(store?.tax_rate_percent ?? 0)}
            initialRoundToNearestCents={store?.round_to_nearest_cents ?? null}
            isOwner={role === "owner"}
          />
        </CardContent>
      </Card>
    </main>
  );
}
