import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { ShippoConnectForm } from "./shippo-connect-form";
import { ShippoConnectionStatus, type ShippingConnectionRow } from "./shippo-connection-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ShippingSettingsPage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const { data: connection, error } = await supabase
    .from("shipping_connections")
    .select("id, provider, status, from_address, last_error")
    .eq("store_id", storeId)
    .eq("provider", "shippo")
    .neq("status", "disconnected")
    .maybeSingle();

  if (error) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-xl font-semibold text-foreground">Shipping</h1>
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Could not load connection: {error.message}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-foreground">Shipping</h1>
      <Card>
        <CardHeader>
          <CardTitle>Shippo</CardTitle>
        </CardHeader>
        <CardContent>
          {connection ? (
            <ShippoConnectionStatus connection={connection as ShippingConnectionRow} />
          ) : (
            <ShippoConnectForm />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
