import type { ShopifyClient } from "./client";
import type { PushResult, SyncListingInput } from "../types";

type ShopLocation = { id: string };

let cachedLocationByShop = new Map<string, ShopLocation>();

async function getPrimaryLocation(client: ShopifyClient): Promise<ShopLocation> {
  const cached = cachedLocationByShop.get(client.shopDomain);
  if (cached) return cached;

  const data = await client.graphql<{ locations: { nodes: ShopLocation[] } }>(
    `{ locations(first: 1) { nodes { id } } }`,
  );
  const location = data.locations.nodes[0];
  if (!location) throw new Error("Shopify shop has no locations configured");

  cachedLocationByShop.set(client.shopDomain, location);
  return location;
}

/** Test-only escape hatch -- the location cache must not leak between
 * unrelated verification runs pointed at different mock shops. */
export function _resetLocationCache(): void {
  cachedLocationByShop = new Map();
}

/** Creates a new Product+Variant for an inventory line that has no existing
 * Shopify listing yet. */
async function createListing(client: ShopifyClient, listing: SyncListingInput): Promise<PushResult> {
  try {
    const location = await getPrimaryLocation(client);

    const createData = await client.graphql<{
      productCreate: {
        product: { id: string; variants: { nodes: { id: string; inventoryItem: { id: string } }[] } };
        userErrors: { message: string }[];
      };
    }>(
      `mutation($input: ProductInput!) {
        productCreate(input: $input) {
          product { id variants(first: 1) { nodes { id inventoryItem { id } } } }
          userErrors { message }
        }
      }`,
      {
        input: {
          title: `${listing.cardName} (${listing.condition})`,
          variants: [{ price: (listing.priceCents / 100).toFixed(2) }],
        },
      },
    );

    const { product, userErrors } = createData.productCreate;
    if (userErrors.length > 0) {
      return { ok: false, error: userErrors.map((e) => e.message).join("; ") };
    }

    const variant = product.variants.nodes[0];
    if (!variant) return { ok: false, error: "Shopify did not return a variant for the created product" };

    await client.graphql(
      `mutation($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) { userErrors { message } }
      }`,
      {
        input: {
          name: "available",
          reason: "correction",
          quantities: [{ inventoryItemId: variant.inventoryItem.id, locationId: location.id, quantity: listing.quantity }],
        },
      },
    );

    return { ok: true, externalListingId: variant.id, externalProductId: product.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Shopify listing creation failed" };
  }
}

/** Updates price/quantity on an existing listing rather than recreating it. */
async function updateListing(
  client: ShopifyClient,
  listing: SyncListingInput,
  existing: { externalListingId: string; externalProductId: string | null },
): Promise<PushResult> {
  try {
    const location = await getPrimaryLocation(client);

    const updateData = await client.graphql<{
      productVariantUpdate: {
        productVariant: { id: string; inventoryItem: { id: string } };
        userErrors: { message: string }[];
      };
    }>(
      `mutation($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant { id inventoryItem { id } }
          userErrors { message }
        }
      }`,
      { input: { id: existing.externalListingId, price: (listing.priceCents / 100).toFixed(2) } },
    );

    const { productVariant, userErrors } = updateData.productVariantUpdate;
    if (userErrors.length > 0) {
      return { ok: false, error: userErrors.map((e) => e.message).join("; ") };
    }

    await client.graphql(
      `mutation($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) { userErrors { message } }
      }`,
      {
        input: {
          name: "available",
          reason: "correction",
          quantities: [{ inventoryItemId: productVariant.inventoryItem.id, locationId: location.id, quantity: listing.quantity }],
        },
      },
    );

    return { ok: true, externalListingId: productVariant.id, externalProductId: existing.externalProductId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Shopify listing update failed" };
  }
}

export async function pushShopifyListing(
  client: ShopifyClient,
  listing: SyncListingInput,
  existing: { externalListingId: string; externalProductId: string | null } | null,
): Promise<PushResult> {
  return existing ? updateListing(client, listing, existing) : createListing(client, listing);
}
