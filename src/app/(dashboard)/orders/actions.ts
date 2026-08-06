"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getMyStore } from "@/lib/supabase/store";
import {
  getShippoClient,
  getShippoRates,
  getShippoShipment,
  purchaseShippoLabel,
  ShippoTransportError,
  type ShippoRate,
} from "@/lib/shipping/shippo/client";
import { getShopifyClient } from "@/lib/sync/shopify/client";
import { pushShopifyTracking } from "@/lib/sync/shopify/push-tracking";
import { getShippingRatesSchema, purchaseLabelSchema } from "@/types/shipping";
import type { Address } from "@/types/shipping";

type ActionResult<T> = T | { error: string };

function addressFromShippingJson(raw: unknown): Address | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = (r.name as string) ?? [r.first_name, r.last_name].filter(Boolean).join(" ") ?? "";
  const street1 = (r.street1 as string) ?? (r.address1 as string) ?? "";
  const city = (r.city as string) ?? "";
  const state = (r.state as string) ?? (r.province as string) ?? "";
  const zip = (r.zip as string) ?? (r.postal_code as string) ?? (r.zipcode as string) ?? "";
  const country = ((r.country as string) ?? "US").slice(0, 2).toUpperCase() || "US";
  if (!street1 || !city || !state || !zip) return null;
  return { name: name || "Customer", street1, city, state, zip, country };
}

export async function getShippingRates(input: {
  marketplaceOrderId: string;
}): Promise<ActionResult<{ shipmentId: string; rates: ShippoRate[] }>> {
  const parsed = getShippingRatesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    const { data: order } = await supabase
      .from("marketplace_orders")
      .select("id, store_id, shipping_address")
      .eq("id", parsed.data.marketplaceOrderId)
      .single();
    if (!order || order.store_id !== storeId) throw new Error("Order not found");

    const toAddress = addressFromShippingJson(order.shipping_address);
    if (!toAddress) throw new Error("This order has no usable shipping address");

    const { data: connection } = await supabase
      .from("shipping_connections")
      .select("id, from_address")
      .eq("store_id", storeId)
      .eq("provider", "shippo")
      .eq("status", "connected")
      .maybeSingle();
    if (!connection || !connection.from_address) throw new Error("Connect Shippo and set a return address in Settings first");

    const service = getServiceClient();
    const { data: credentials } = await service
      .from("shipping_credentials")
      .select("shippo_api_key")
      .eq("connection_id", connection.id)
      .single();
    if (!credentials?.shippo_api_key) throw new Error("Shippo credentials not found");

    const client = getShippoClient(credentials.shippo_api_key);
    const result = await getShippoRates(client, connection.from_address as Address, toAddress);
    if (!result.ok) throw new Error(result.error);

    return { shipmentId: result.shipmentId, rates: result.rates };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not get shipping rates" };
  }
}

export async function purchaseLabel(input: {
  marketplaceOrderId: string;
  shipmentId: string;
  rateObjectId: string;
}): Promise<ActionResult<{ shipmentId: string; trackingNumber: string; labelUrl: string }>> {
  const parsed = purchaseLabelSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    const { data: order } = await supabase
      .from("marketplace_orders")
      .select("id, store_id, platform, external_order_id, status, shipping_address")
      .eq("id", parsed.data.marketplaceOrderId)
      .single();
    if (!order || order.store_id !== storeId) throw new Error("Order not found");

    const toAddress = addressFromShippingJson(order.shipping_address);
    if (!toAddress) throw new Error("This order has no usable shipping address");

    const { data: connection } = await supabase
      .from("shipping_connections")
      .select("id")
      .eq("store_id", storeId)
      .eq("provider", "shippo")
      .eq("status", "connected")
      .maybeSingle();
    if (!connection) throw new Error("Shippo is not connected");

    const service = getServiceClient();
    const { data: credentials } = await service
      .from("shipping_credentials")
      .select("shippo_api_key")
      .eq("connection_id", connection.id)
      .single();
    if (!credentials?.shippo_api_key) throw new Error("Shippo credentials not found");

    const client = getShippoClient(credentials.shippo_api_key);

    // The claim's INSERT (guarded by shipments.marketplace_order_id being
    // UNIQUE) is the actual atomic reservation -- it happens BEFORE any
    // money is spent, so two concurrent purchaseLabel calls for the same
    // order (two tabs, a retried request) can't both get past this point.
    // A plain status pre-check alone can't close that race: both calls
    // could read "not fulfilled" before either commits.
    const { data: shipmentRowId, error: claimError } = await supabase.rpc("claim_shipment_for_label", {
      p_marketplace_order_id: order.id,
    });
    if (claimError) throw new Error(claimError.message);

    // Re-fetch the shipment server-side and verify the client-supplied
    // rate actually belongs to it (not a rate id copied from a different
    // order's quote) before spending real money -- also lets us derive the
    // real carrier/service/amount from Shippo's own data instead of
    // trusting client-supplied strings.
    let purchase: Awaited<ReturnType<typeof purchaseShippoLabel>>;
    let verifiedRate: ShippoRate;
    try {
      const shipmentDetail = await getShippoShipment(client, parsed.data.shipmentId);
      if (shipmentDetail.addressToZip !== toAddress.zip) {
        throw new Error("The quoted rate doesn't match this order's shipping address");
      }
      const matchedRate = shipmentDetail.rates.find((r) => r.objectId === parsed.data.rateObjectId);
      if (!matchedRate) {
        throw new Error("That rate is no longer available -- get rates again");
      }
      verifiedRate = matchedRate;

      purchase = await purchaseShippoLabel(client, matchedRate.objectId, matchedRate.provider, matchedRate.serviceLevelName);
      if (!purchase.ok) throw new Error(purchase.error);
    } catch (err) {
      if (err instanceof ShippoTransportError) {
        // The purchase request never got a response -- Shippo may have
        // received and processed it anyway, so we genuinely don't know
        // whether a label/charge already exists. Deliberately does NOT
        // release the claim: an automatic retry here could purchase a real
        // second label with no record tying it back to the first. The
        // order stays claimed (unshippable) until staff checks the Shippo
        // dashboard and, if nothing was actually charged, releases it
        // manually -- fail closed rather than risk a silent double charge.
        throw new Error(
          `Could not confirm whether the label purchase succeeded (${err.message}). ` +
            "Check the Shippo dashboard for this order before trying again -- the shipment reservation was left in place to prevent a duplicate purchase.",
        );
      }
      // Verification failed before any purchase call, or Shippo explicitly
      // rejected the purchase -- nothing was charged, safe to release.
      await supabase.rpc("release_shipment_claim", { p_shipment_id: shipmentRowId });
      throw err;
    }

    const { error: finalizeError } = await supabase.rpc("finalize_shipment", {
      p_shipment_id: shipmentRowId,
      p_shippo_shipment_id: parsed.data.shipmentId,
      p_shippo_transaction_id: purchase.transactionId,
      p_tracking_number: purchase.trackingNumber,
      p_tracking_url: purchase.trackingUrl,
      p_label_url: purchase.labelUrl,
      p_carrier_name: purchase.carrierName,
      p_service_level: purchase.serviceLevel,
      p_rate_cents: verifiedRate.amountCents,
    });
    if (finalizeError) {
      // The label is already bought and paid for -- log the transaction id
      // so it isn't lost to a database error, since this can't be retried
      // without risking a second real charge.
      console.error(
        `finalize_shipment failed after a successful Shippo purchase -- transaction ${purchase.transactionId} for order ${order.id} needs manual reconciliation:`,
        finalizeError.message,
      );
      throw new Error("Label was purchased but could not be saved -- contact support with this info: " + purchase.transactionId);
    }

    // Best-effort, non-blocking -- the label is already bought and paid
    // for by this point, so a tracking-push failure must not undo or block
    // that; it's recorded for staff to see, not surfaced as a hard error.
    if (order.platform === "shopify") {
      try {
        const { data: shopifyConnection } = await supabase
          .from("marketplace_connections")
          .select("id, shop_domain")
          .eq("store_id", storeId)
          .eq("platform", "shopify")
          .eq("status", "connected")
          .maybeSingle();
        if (shopifyConnection?.shop_domain) {
          const { data: shopifyCreds } = await service
            .from("marketplace_credentials")
            .select("shopify_access_token")
            .eq("connection_id", shopifyConnection.id)
            .single();
          if (shopifyCreds?.shopify_access_token) {
            const shopifyClient = getShopifyClient(shopifyConnection.shop_domain, shopifyCreds.shopify_access_token);
            const trackingResult = await pushShopifyTracking(
              shopifyClient,
              order.external_order_id,
              purchase.trackingNumber,
              purchase.trackingUrl,
              purchase.carrierName,
            );
            if (!trackingResult.ok) {
              await supabase.from("shipments").update({ tracking_push_error: trackingResult.error }).eq("id", shipmentRowId);
            }
          }
        }
      } catch (err) {
        await supabase
          .from("shipments")
          .update({ tracking_push_error: err instanceof Error ? err.message : "Tracking push failed" })
          .eq("id", shipmentRowId);
      }
    }

    revalidatePath("/orders");
    revalidatePath(`/orders/${order.id}`);
    return { shipmentId: shipmentRowId as string, trackingNumber: purchase.trackingNumber, labelUrl: purchase.labelUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not purchase label" };
  }
}
