import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";

/** Tracking status update: single shipment, must respond fast, same class
 * as the Shopify order webhook -- runs inline, not queued. Shippo has no
 * documented payload-signing mechanism (see the webhook_token comment in
 * the migration), so verification is a shared token embedded in the URL
 * the merchant configures in Shippo's dashboard, not a signature header. */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const supabase = getServiceClient();

  // A valid webhook_token only proves "some connected Shippo integration" --
  // it authenticates the store, not the specific shipment. Resolving the
  // owning store_id here and scoping the later update to it stops a token
  // holder from mutating another store's shipment by guessing/observing its
  // tracking number (tracking numbers aren't secret -- they're printed on
  // the package label).
  const { data: credentials } = await supabase
    .from("shipping_credentials")
    .select("shipping_connections(store_id)")
    .eq("webhook_token", token)
    .maybeSingle();
  const storeId = (credentials?.shipping_connections as unknown as { store_id: string } | null)?.store_id;
  if (!storeId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const rawBody = await request.text();
  const payload = JSON.parse(rawBody);

  // A tracking object's object_id stays fixed across every status update
  // for the same shipment (label_created -> in_transit -> delivered all
  // reference the same tracking object) -- keying dedup on object_id+event
  // alone made every update after the first collide with the first and get
  // silently dropped, so shipments.status could never advance past
  // whatever arrived first. Hashing the full payload means any genuinely
  // different status update produces a different key, while an exact
  // redelivery of the same event still dedupes correctly.
  const eventId = createHash("sha256").update(rawBody).digest("hex");

  const { data: dedupRow, error: dedupError } = await supabase
    .from("processed_webhook_events")
    .insert({ source: "shippo", event_id: eventId })
    .select("id")
    .maybeSingle();
  if (dedupError) {
    // Postgres unique_violation (23505) means a genuine duplicate delivery
    // -- correct to treat as a no-op. Any other error (transient DB issue,
    // connection blip) must NOT be silently treated the same way, or a
    // real event gets dropped with no retry and no record.
    if (dedupError.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("Shippo webhook dedup insert failed", dedupError);
    return NextResponse.json({ error: "Could not process webhook" }, { status: 500 });
  }
  if (!dedupRow) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (payload.event === "track_updated" && payload.data?.tracking_number) {
    const shippoStatus: string = payload.data.tracking_status?.status ?? "";
    const status = shippoStatus === "DELIVERED" ? "delivered" : shippoStatus === "TRANSIT" ? "in_transit" : null;

    if (status) {
      await supabase
        .from("shipments")
        .update({ status })
        .eq("tracking_number", payload.data.tracking_number)
        .eq("store_id", storeId);
    }
  }

  return NextResponse.json({ ok: true });
}
