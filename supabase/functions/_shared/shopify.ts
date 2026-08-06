// Deno-side mirror of src/lib/sync/shopify/client.ts + push-listing.ts.
// Edge Functions run on Deno, not Node, so this can't import from src/lib
// directly -- kept as a deliberate, small, fetch-only duplication rather
// than forcing one file to run in both runtimes (see the module plan).

const API_VERSION = "2024-10";

export type ShopifyClient = {
  shopDomain: string;
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
};

export function getShopifyClient(shopDomain: string, accessToken: string): ShopifyClient {
  const baseUrl = Deno.env.get("SHOPIFY_API_BASE_URL") || `https://${shopDomain}`;

  return {
    shopDomain,
    async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      const res = await fetch(`${baseUrl}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new Error(`Shopify API error: ${res.status} ${await res.text()}`);
      const json = await res.json();
      if (json.errors) throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
      return json.data as T;
    },
  };
}

export type SyncListingInput = {
  inventoryItemId: string;
  cardId: string;
  cardName: string;
  condition: string;
  quantity: number;
  priceCents: number;
};

export type PushResult =
  | { ok: true; externalListingId: string; externalProductId: string | null }
  | { ok: false; error: string };

const locationCache = new Map<string, string>();

async function getPrimaryLocationId(client: ShopifyClient): Promise<string> {
  const cached = locationCache.get(client.shopDomain);
  if (cached) return cached;

  const data = await client.graphql<{ locations: { nodes: { id: string }[] } }>(
    `{ locations(first: 1) { nodes { id } } }`,
  );
  const id = data.locations.nodes[0]?.id;
  if (!id) throw new Error("Shopify shop has no locations configured");
  locationCache.set(client.shopDomain, id);
  return id;
}

export async function pushShopifyListing(
  client: ShopifyClient,
  listing: SyncListingInput,
  existing: { externalListingId: string; externalProductId: string | null } | null,
): Promise<PushResult> {
  try {
    const locationId = await getPrimaryLocationId(client);

    if (existing) {
      const data = await client.graphql<{
        productVariantUpdate: { productVariant: { id: string; inventoryItem: { id: string } }; userErrors: { message: string }[] };
      }>(
        `mutation($input: ProductVariantInput!) {
          productVariantUpdate(input: $input) {
            productVariant { id inventoryItem { id } }
            userErrors { message }
          }
        }`,
        { input: { id: existing.externalListingId, price: (listing.priceCents / 100).toFixed(2) } },
      );
      if (data.productVariantUpdate.userErrors.length > 0) {
        return { ok: false, error: data.productVariantUpdate.userErrors.map((e) => e.message).join("; ") };
      }
      await client.graphql(
        `mutation($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { userErrors { message } } }`,
        {
          input: {
            name: "available",
            reason: "correction",
            quantities: [{ inventoryItemId: data.productVariantUpdate.productVariant.inventoryItem.id, locationId, quantity: listing.quantity }],
          },
        },
      );
      return { ok: true, externalListingId: data.productVariantUpdate.productVariant.id, externalProductId: existing.externalProductId };
    }

    const created = await client.graphql<{
      productCreate: { product: { id: string; variants: { nodes: { id: string; inventoryItem: { id: string } }[] } }; userErrors: { message: string }[] };
    }>(
      `mutation($input: ProductInput!) {
        productCreate(input: $input) {
          product { id variants(first: 1) { nodes { id inventoryItem { id } } } }
          userErrors { message }
        }
      }`,
      { input: { title: `${listing.cardName} (${listing.condition})`, variants: [{ price: (listing.priceCents / 100).toFixed(2) }] } },
    );
    if (created.productCreate.userErrors.length > 0) {
      return { ok: false, error: created.productCreate.userErrors.map((e) => e.message).join("; ") };
    }
    const variant = created.productCreate.product.variants.nodes[0];
    if (!variant) return { ok: false, error: "Shopify did not return a variant for the created product" };

    await client.graphql(
      `mutation($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { userErrors { message } } }`,
      { input: { name: "available", reason: "correction", quantities: [{ inventoryItemId: variant.inventoryItem.id, locationId, quantity: listing.quantity }] } },
    );

    return { ok: true, externalListingId: variant.id, externalProductId: created.productCreate.product.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Shopify listing push failed" };
  }
}
