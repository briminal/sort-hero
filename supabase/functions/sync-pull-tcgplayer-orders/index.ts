// Polling job, not webhook-driven -- see src/lib/sync/tcgplayer/poll-orders.ts's
// caveat: TCGplayer's Seller API order-retrieval mechanism isn't confirmed
// to support webhooks, so this polls on its own cron cadence instead.

import { getAdminClient } from "../_shared/supabase-admin.ts";
import { getTcgplayerClient, parseTcgplayerOrder } from "../_shared/tcgplayer.ts";
import { resolveAndImportOrder } from "../_shared/import-order.ts";

Deno.serve(async (req: Request) => {
  const { connectionId, storeId } = await req.json();
  const supabase = getAdminClient();

  // start_sync_job_run atomically inserts the running row (or returns null
  // if one already exists) via a partial unique index -- see the migration
  // for why a session-level advisory lock doesn't work over Supabase's
  // pooled RPC interface.
  const { data: runId } = await supabase.rpc("start_sync_job_run", { p_store_id: storeId, p_job_type: "pull_orders" });
  if (!runId) {
    return new Response(JSON.stringify({ ok: false, error: "already running" }), { status: 409 });
  }
  const run = { id: runId };

  let itemsProcessed = 0;

  try {
    const { data: connection } = await supabase
      .from("marketplace_connections")
      .select("tcgplayer_store_key, last_synced_at")
      .eq("id", connectionId)
      .single();
    const { data: credentials } = await supabase
      .from("marketplace_credentials")
      .select("tcgplayer_api_key, tcgplayer_api_secret")
      .eq("connection_id", connectionId)
      .single();
    if (!connection || !credentials) throw new Error("Connection or credentials not found");

    const client = await getTcgplayerClient(supabase, connectionId, credentials.tcgplayer_api_key, credentials.tcgplayer_api_secret);

    // The next cursor must be the time this request was ISSUED, not when it
    // finished -- an order created while this request was in flight (or one
    // TCGplayer's backend hadn't finished indexing yet when it processed
    // `since`) could exist but not be present in `data.orders`. Using the
    // post-request time as the new cursor would move past that order's
    // timestamp forever, silently skipping it on every future poll.
    // Starting the next poll's `since` from before this request was sent
    // means an order missed this way is simply re-included next time --
    // resolveAndImportOrder/import_marketplace_order is idempotent, so
    // re-seeing an already-imported order is a no-op, not a double-import.
    const requestStartedAt = new Date().toISOString();
    const query = connection.last_synced_at ? `?since=${encodeURIComponent(connection.last_synced_at)}` : "";
    const data = await client.request<{ orders: Parameters<typeof parseTcgplayerOrder>[0][] }>(
      `/order/${connection.tcgplayer_store_key}/orders${query}`,
    );

    for (const rawOrderPayload of data.orders) {
      const parsed = parseTcgplayerOrder(rawOrderPayload);
      await resolveAndImportOrder(supabase, storeId, connectionId, "tcgplayer", parsed);
      itemsProcessed++;
    }

    await supabase.from("marketplace_connections").update({ last_synced_at: requestStartedAt, status: "connected" }).eq("id", connectionId);
    await supabase.from("sync_job_runs").update({ status: "succeeded", finished_at: new Date().toISOString(), items_processed: itemsProcessed }).eq("id", run.id);

    return new Response(JSON.stringify({ ok: true, itemsProcessed }), { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pull orders failed";
    await supabase.from("sync_job_runs").update({ status: "failed", error: message, finished_at: new Date().toISOString(), items_processed: itemsProcessed }).eq("id", run.id);
    await supabase.from("marketplace_connections").update({ status: "error", last_error: message }).eq("id", connectionId);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 });
  }
  // No separate "release" step needed -- updating the row's status out of
  // 'running' above is what frees the partial unique index for a future run.
});
