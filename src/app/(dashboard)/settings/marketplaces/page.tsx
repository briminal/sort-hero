import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { ShopifyConnectForm } from "./shopify-connect-form";
import { TcgplayerConnectForm } from "./tcgplayer-connect-form";
import { SyncStatus, type ConnectionRow, type SyncJobRunRow } from "./sync-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function MarketplacesSettingsPage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const { data: connections, error } = await supabase
    .from("marketplace_connections")
    .select("id, platform, status, shop_domain, tcgplayer_store_key, last_synced_at, last_error, auto_sync_enabled")
    .eq("store_id", storeId);

  if (error) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-xl font-semibold text-foreground">Marketplaces</h1>
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Could not load connections: {error.message}
        </p>
      </main>
    );
  }

  const { data: recentRuns } = await supabase
    .from("sync_job_runs")
    .select("id, job_type, status, started_at, finished_at, error, items_processed")
    .eq("store_id", storeId)
    .order("started_at", { ascending: false })
    .limit(20);

  const shopifyConnection = (connections ?? []).find((c) => c.platform === "shopify" && c.status !== "disconnected") ?? null;
  const tcgplayerConnection = (connections ?? []).find((c) => c.platform === "tcgplayer" && c.status !== "disconnected") ?? null;

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-foreground">Marketplaces</h1>

      <Card>
        <CardHeader>
          <CardTitle>Shopify</CardTitle>
        </CardHeader>
        <CardContent>
          {shopifyConnection ? (
            <SyncStatus
              storeId={storeId}
              connection={shopifyConnection as ConnectionRow}
              initialRuns={(recentRuns ?? []) as SyncJobRunRow[]}
            />
          ) : (
            <ShopifyConnectForm />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>TCGplayer</CardTitle>
        </CardHeader>
        <CardContent>
          {tcgplayerConnection ? (
            <SyncStatus
              storeId={storeId}
              connection={tcgplayerConnection as ConnectionRow}
              initialRuns={(recentRuns ?? []) as SyncJobRunRow[]}
            />
          ) : (
            <TcgplayerConnectForm />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
