// Bulk outbound push: many rate-limited external API calls, one per
// inventory item -- this is exactly the "long-running work" CLAUDE.md says
// must not run inline in a Next.js API route. Invoked by
// src/app/api/jobs/marketplace-sync/route.ts (scheduled) or by the
// settings UI's "sync now" Server Action (manual), both fire-and-forget.

import { getAdminClient } from "../_shared/supabase-admin.ts";
import { getShopifyClient, pushShopifyListing } from "../_shared/shopify.ts";
import { getTcgplayerClient } from "../_shared/tcgplayer.ts";
import { pushTcgplayerListing } from "../_shared/tcgplayer-push.ts";

Deno.serve(async (req: Request) => {
  const { connectionId, storeId } = await req.json();
  const supabase = getAdminClient();

  // start_sync_job_run atomically inserts the running row (or returns null
  // if one already exists) via a partial unique index -- see the migration
  // for why a session-level advisory lock doesn't work over Supabase's
  // pooled RPC interface.
  const { data: runId } = await supabase.rpc("start_sync_job_run", { p_store_id: storeId, p_job_type: "push_listings" });
  if (!runId) {
    return new Response(JSON.stringify({ ok: false, error: "already running" }), { status: 409 });
  }
  const run = { id: runId };

  let itemsProcessed = 0;

  try {
    const { data: connection } = await supabase.from("marketplace_connections").select("platform, shop_domain, tcgplayer_store_key").eq("id", connectionId).single();
    const { data: credentials } = await supabase.from("marketplace_credentials").select("*").eq("connection_id", connectionId).single();
    if (!connection || !credentials) throw new Error("Connection or credentials not found");

    const { data: items } = await supabase
      .from("inventory_items")
      .select("id, card_id, condition, quantity, price_cents, cards(name)")
      .eq("store_id", storeId)
      .not("price_cents", "is", null);

    for (const item of items ?? []) {
      const { data: existingListing } = await supabase
        .from("marketplace_listings")
        .select("external_listing_id, external_product_id")
        .eq("inventory_item_id", item.id)
        .eq("platform", connection.platform)
        .maybeSingle();

      const listingInput = {
        inventoryItemId: item.id,
        cardId: item.card_id,
        cardName: item.cards.name,
        condition: item.condition,
        quantity: item.quantity,
        priceCents: item.price_cents,
      };

      const result =
        connection.platform === "shopify"
          ? await pushShopifyListing(
              getShopifyClient(connection.shop_domain, credentials.shopify_access_token),
              listingInput,
              existingListing?.external_listing_id
                ? { externalListingId: existingListing.external_listing_id, externalProductId: existingListing.external_product_id }
                : null,
            )
          : await pushTcgplayerListing(
              await getTcgplayerClient(supabase, connectionId, credentials.tcgplayer_api_key, credentials.tcgplayer_api_secret),
              supabase,
              connection.tcgplayer_store_key,
              listingInput,
            );

      if (result.ok) {
        await supabase.from("marketplace_listings").upsert(
          {
            store_id: storeId,
            inventory_item_id: item.id,
            connection_id: connectionId,
            platform: connection.platform,
            external_listing_id: result.externalListingId,
            external_product_id: result.externalProductId,
            status: "active",
            last_pushed_price_cents: item.price_cents,
            last_pushed_quantity: item.quantity,
            last_synced_at: new Date().toISOString(),
            last_error: null,
          },
          { onConflict: "inventory_item_id,platform" },
        );
      } else {
        await supabase.from("marketplace_listings").upsert(
          {
            store_id: storeId,
            inventory_item_id: item.id,
            connection_id: connectionId,
            platform: connection.platform,
            status: "error",
            last_error: result.error,
          },
          { onConflict: "inventory_item_id,platform" },
        );
      }

      itemsProcessed++;
    }

    await supabase.from("marketplace_connections").update({ last_synced_at: new Date().toISOString(), status: "connected" }).eq("id", connectionId);
    await supabase.from("sync_job_runs").update({ status: "succeeded", finished_at: new Date().toISOString(), items_processed: itemsProcessed }).eq("id", run.id);

    return new Response(JSON.stringify({ ok: true, itemsProcessed }), { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Push listings failed";
    await supabase.from("sync_job_runs").update({ status: "failed", error: message, finished_at: new Date().toISOString(), items_processed: itemsProcessed }).eq("id", run.id);
    await supabase.from("marketplace_connections").update({ status: "error", last_error: message }).eq("id", connectionId);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 });
  }
  // No separate "release" step needed -- updating the row's status out of
  // 'running' above is what frees the partial unique index for a future run.
});
