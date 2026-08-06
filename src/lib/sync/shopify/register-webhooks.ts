import type { ShopifyClient } from "./client";

const ORDER_TOPICS = ["ORDERS_CREATE", "ORDERS_PAID", "ORDERS_CANCELLED"] as const;

export async function registerOrderWebhooks(client: ShopifyClient, callbackUrl: string): Promise<void> {
  for (const topic of ORDER_TOPICS) {
    await client.graphql(
      `mutation($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          userErrors { message }
        }
      }`,
      { topic, webhookSubscription: { callbackUrl, format: "JSON" } },
    );
  }
}

/** Best-effort -- called on disconnect. Failures are swallowed by the
 * caller (the connection is being torn down locally either way). */
export async function deregisterWebhooks(client: ShopifyClient): Promise<void> {
  const data = await client.graphql<{ webhookSubscriptions: { nodes: { id: string }[] } }>(
    `{ webhookSubscriptions(first: 50) { nodes { id } } }`,
  );

  for (const node of data.webhookSubscriptions.nodes) {
    await client.graphql(`mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId } }`, {
      id: node.id,
    });
  }
}
