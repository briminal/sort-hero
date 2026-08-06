import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { verifyShopifyHmac } from "@/lib/sync/shopify/verify-webhook";
import { parseShopifyOrder } from "@/lib/sync/shopify/parse-order";
import { resolveInventoryMatches } from "@/lib/sync/resolve-inventory-match";
import { importSyncOrder } from "@/lib/sync/import-order";

/** Single-order webhook: small payload, must respond fast (Shopify retries
 * and eventually disables webhooks that don't 200 promptly), so this runs
 * inline rather than being queued -- unlike the bulk listing push, which
 * goes through the Edge Function. Verify HMAC -> dedup -> import, in that
 * order, so an unverified or duplicate request never reaches the DB. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain");
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");
  const topic = request.headers.get("X-Shopify-Topic");

  if (!shopDomain || !webhookId || !topic) {
    return NextResponse.json({ error: "Missing required Shopify headers" }, { status: 400 });
  }

  const supabase = getServiceClient();

  const { data: connection } = await supabase
    .from("marketplace_connections")
    .select("id, store_id")
    .eq("platform", "shopify")
    .eq("shop_domain", shopDomain)
    .eq("status", "connected")
    .maybeSingle();
  if (!connection) {
    // Unknown/disconnected shop -- 200 so Shopify doesn't keep retrying a
    // webhook we intentionally don't want anymore, but do nothing.
    return NextResponse.json({ ok: true });
  }

  const { data: credentials } = await supabase
    .from("marketplace_credentials")
    .select("shopify_webhook_secret")
    .eq("connection_id", connection.id)
    .single();
  if (!credentials?.shopify_webhook_secret || !verifyShopifyHmac(rawBody, hmacHeader, credentials.shopify_webhook_secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Dedup on Shopify's own webhook delivery id -- a retried delivery is a
  // deliberate no-op, not a second import.
  const { data: dedupRow, error: dedupError } = await supabase
    .from("processed_webhook_events")
    .insert({ source: "shopify", event_id: webhookId })
    .select("id")
    .maybeSingle();
  if (dedupError) {
    // Postgres unique_violation (23505) means a genuine duplicate delivery
    // -- correct to treat as a no-op. Any other error (transient DB issue)
    // must NOT be silently treated the same way, or a real order import
    // gets dropped with no retry and no record.
    if (dedupError.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("Shopify webhook dedup insert failed", dedupError);
    return NextResponse.json({ error: "Could not process webhook" }, { status: 500 });
  }
  if (!dedupRow) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (topic === "orders/create" || topic === "orders/paid") {
    try {
      const payload = JSON.parse(rawBody);
      const rawOrder = parseShopifyOrder(payload);
      const order = await resolveInventoryMatches(supabase, connection.id, rawOrder);
      await importSyncOrder(supabase, connection.store_id, connection.id, "shopify", order);
      await supabase
        .from("marketplace_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", connection.id);
    } catch (err) {
      console.error("Shopify webhook processing failed", err);
      // Still 200: the event is already deduped, and Shopify would just
      // retry an identical payload if we 500'd -- log server-side for
      // investigation instead of triggering a retry storm.
      return NextResponse.json({ ok: true, processingError: true });
    }
  }

  return NextResponse.json({ ok: true });
}
