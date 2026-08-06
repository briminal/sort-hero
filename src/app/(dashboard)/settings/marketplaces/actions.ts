"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getMyStore } from "@/lib/supabase/store";
import { verifyShopifyConnection, getShopifyClient } from "@/lib/sync/shopify/client";
import { registerOrderWebhooks, deregisterWebhooks } from "@/lib/sync/shopify/register-webhooks";
import { verifyTcgplayerConnection } from "@/lib/sync/tcgplayer/client";
import {
  connectShopifySchema,
  connectTcgplayerSchema,
  disconnectMarketplaceSchema,
  triggerSyncNowSchema,
  updateConnectionSettingsSchema,
} from "@/types/marketplace-sync";

type ActionResult<T> = T | { error: string };

async function requireOwner(): Promise<{ storeId: string }> {
  const supabase = await createClient();
  const { storeId, role } = await getMyStore(supabase);
  if (role !== "owner") {
    throw new Error("Only a store owner can manage marketplace connections");
  }
  return { storeId };
}

export async function connectShopify(input: {
  shopDomain: string;
  accessToken: string;
  webhookSecret: string;
}): Promise<ActionResult<{ connectionId: string }>> {
  const parsed = connectShopifySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const { storeId } = await requireOwner();

    // Connectivity check with the submitted token BEFORE persisting anything.
    const client = getShopifyClient(parsed.data.shopDomain, parsed.data.accessToken);
    await verifyShopifyConnection(client);

    const service = getServiceClient();

    const { data: connection, error: connectionError } = await service
      .from("marketplace_connections")
      .upsert(
        { store_id: storeId, platform: "shopify", status: "connected", shop_domain: parsed.data.shopDomain, last_error: null },
        { onConflict: "store_id,platform" },
      )
      .select("id")
      .single();
    if (connectionError || !connection) throw new Error(connectionError?.message ?? "Could not save connection");

    const { error: credentialsError } = await service.from("marketplace_credentials").upsert({
      connection_id: connection.id,
      shopify_access_token: parsed.data.accessToken,
      shopify_webhook_secret: parsed.data.webhookSecret,
    });
    if (credentialsError) throw new Error(credentialsError.message);

    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/shopify`;
    await registerOrderWebhooks(client, callbackUrl);

    revalidatePath("/settings/marketplaces");
    return { connectionId: connection.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not connect Shopify" };
  }
}

export async function connectTcgplayer(input: {
  storeKey: string;
  apiKey: string;
  apiSecret: string;
}): Promise<ActionResult<{ connectionId: string }>> {
  const parsed = connectTcgplayerSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const { storeId } = await requireOwner();

    // Connectivity check -- the token exchange itself validates the key/secret.
    await verifyTcgplayerConnection(parsed.data.apiKey, parsed.data.apiSecret);

    const service = getServiceClient();

    const { data: connection, error: connectionError } = await service
      .from("marketplace_connections")
      .upsert(
        { store_id: storeId, platform: "tcgplayer", status: "connected", tcgplayer_store_key: parsed.data.storeKey, last_error: null },
        { onConflict: "store_id,platform" },
      )
      .select("id")
      .single();
    if (connectionError || !connection) throw new Error(connectionError?.message ?? "Could not save connection");

    const { error: credentialsError } = await service.from("marketplace_credentials").upsert({
      connection_id: connection.id,
      tcgplayer_api_key: parsed.data.apiKey,
      tcgplayer_api_secret: parsed.data.apiSecret,
    });
    if (credentialsError) throw new Error(credentialsError.message);

    revalidatePath("/settings/marketplaces");
    return { connectionId: connection.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not connect TCGplayer" };
  }
}

export async function disconnectMarketplace(input: { connectionId: string }): Promise<ActionResult<{ ok: true }>> {
  const parsed = disconnectMarketplaceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const { storeId } = await requireOwner();
    const service = getServiceClient();

    const { data: connection } = await service
      .from("marketplace_connections")
      .select("id, store_id, platform, shop_domain")
      .eq("id", parsed.data.connectionId)
      .single();
    if (!connection || connection.store_id !== storeId) throw new Error("Connection not found");

    if (connection.platform === "shopify") {
      const { data: credentials } = await service
        .from("marketplace_credentials")
        .select("shopify_access_token")
        .eq("connection_id", connection.id)
        .single();
      if (credentials?.shopify_access_token && connection.shop_domain) {
        try {
          const client = getShopifyClient(connection.shop_domain, credentials.shopify_access_token);
          await deregisterWebhooks(client);
        } catch {
          // Best-effort -- the connection is being torn down locally regardless.
        }
      }
    }

    await service
      .from("marketplace_connections")
      .update({ status: "disconnected" })
      .eq("id", connection.id);

    // Row stays for audit trail, secrets are nulled -- flag-not-delete, same
    // convention as every other module.
    await service
      .from("marketplace_credentials")
      .update({
        shopify_access_token: null,
        shopify_webhook_secret: null,
        tcgplayer_api_key: null,
        tcgplayer_api_secret: null,
        tcgplayer_bearer_token: null,
        tcgplayer_bearer_expires_at: null,
      })
      .eq("connection_id", connection.id);

    revalidatePath("/settings/marketplaces");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not disconnect" };
  }
}

export async function updateConnectionSettings(input: {
  connectionId: string;
  autoSyncEnabled: boolean;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = updateConnectionSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    // updateConnectionSettings is owner-gated by RLS (marketplace_connections_update
    // requires is_store_owner) -- but PostgREST doesn't error when RLS blocks
    // a row, it just updates 0 rows, so without checking the affected row a
    // non-owner staff member calling this would silently get back { ok: true }
    // even though nothing changed. requireOwner() gives a real error instead,
    // and checking the returned row is belt-and-suspenders against the same
    // silent-no-op if the connection simply doesn't belong to this store.
    await requireOwner();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("marketplace_connections")
      .update({ auto_sync_enabled: parsed.data.autoSyncEnabled })
      .eq("id", parsed.data.connectionId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("Connection not found");

    revalidatePath("/settings/marketplaces");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update settings" };
  }
}

export async function triggerSyncNow(input: {
  connectionId: string;
  jobType: "push_listings" | "pull_orders";
}): Promise<ActionResult<{ started: true }>> {
  const parsed = triggerSyncNowSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const { storeId } = await requireOwner();
    const supabase = await createClient();

    const { data: connection } = await supabase
      .from("marketplace_connections")
      .select("id, store_id, platform")
      .eq("id", parsed.data.connectionId)
      .single();
    if (!connection || connection.store_id !== storeId) throw new Error("Connection not found");

    // pull_orders only exists for TCGplayer (sync-pull-tcgplayer-orders reads
    // tcgplayer_api_key/secret specifically) -- jobType was previously
    // trusted from client input with no cross-check against the connection's
    // actual platform, so requesting pull_orders against e.g. a Shopify
    // connection would invoke the TCGplayer function with null credentials,
    // fail, and flip that (unrelated) connection's status to 'error',
    // silently disabling its real auto-sync.
    if (parsed.data.jobType === "pull_orders" && connection.platform !== "tcgplayer") {
      throw new Error("Pulling orders is only available for TCGplayer connections");
    }

    const functionName = parsed.data.jobType === "push_listings" ? "sync-push-listings" : "sync-pull-tcgplayer-orders";
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase env not configured");

    // Fire-and-forget -- the Edge Function itself acquires the lock and
    // logs to sync_job_runs; this action doesn't wait for the sync to finish.
    void fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: connection.id, storeId }),
    }).catch((err) => {
      console.error(`Failed to invoke ${functionName}`, err);
    });

    return { started: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start sync" };
  }
}

