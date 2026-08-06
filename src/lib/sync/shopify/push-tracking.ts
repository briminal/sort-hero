import type { ShopifyClient } from "./client";

export type TrackingPushResult = { ok: true } | { ok: false; error: string };

/** Pushes a tracking number back to Shopify once a label is purchased.
 * Best-effort, non-blocking (see the Orders & Shipping plan: failure is
 * swallowed into shipments.tracking_push_error, never blocks the label
 * purchase itself, since the label is already bought and paid for by the
 * time this runs). Uses Shopify's fulfillment-order-based Fulfillment API
 * (the modern replacement for the deprecated order-level fulfillment
 * endpoint) -- unverified against a real Shopify account, same caveat as
 * every other Shopify/TCGplayer integration point in this project without
 * real API access; the shape here reflects best-effort understanding of
 * the documented contract. */
export async function pushShopifyTracking(
  client: ShopifyClient,
  externalOrderId: string,
  trackingNumber: string,
  trackingUrl: string,
  carrierName: string,
): Promise<TrackingPushResult> {
  try {
    const orderGid = externalOrderId.startsWith("gid://") ? externalOrderId : `gid://shopify/Order/${externalOrderId}`;

    const fulfillmentOrdersData = await client.graphql<{
      order: { fulfillmentOrders: { nodes: { id: string; lineItems: { nodes: { id: string; remainingQuantity: number }[] } }[] } } | null;
    }>(
      `query($id: ID!) {
        order(id: $id) {
          fulfillmentOrders(first: 5) {
            nodes { id lineItems(first: 50) { nodes { id remainingQuantity } } }
          }
        }
      }`,
      { id: orderGid },
    );

    const fulfillmentOrder = fulfillmentOrdersData.order?.fulfillmentOrders.nodes[0];
    if (!fulfillmentOrder) {
      return { ok: false, error: "No open fulfillment order found for this Shopify order" };
    }

    const lineItems = fulfillmentOrder.lineItems.nodes
      .filter((li) => li.remainingQuantity > 0)
      .map((li) => ({ id: li.id, quantity: li.remainingQuantity }));

    const result = await client.graphql<{
      fulfillmentCreate: { userErrors: { message: string }[] };
    }>(
      `mutation($fulfillment: FulfillmentInput!) {
        fulfillmentCreate(fulfillment: $fulfillment) { userErrors { message } }
      }`,
      {
        fulfillment: {
          lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fulfillmentOrder.id, fulfillmentOrderLineItems: lineItems }],
          trackingInfo: { number: trackingNumber, url: trackingUrl, company: carrierName },
          notifyCustomer: true,
        },
      },
    );

    if (result.fulfillmentCreate.userErrors.length > 0) {
      return { ok: false, error: result.fulfillmentCreate.userErrors.map((e) => e.message).join("; ") };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not push tracking to Shopify" };
  }
}
