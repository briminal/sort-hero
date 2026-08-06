import type { ShopifyClient } from "./client";

/** Best-effort -- the caller marks marketplace_listings.status='delisted'
 * regardless of whether the remote delete succeeds, since the shop should
 * stop selling it locally-tracked-as-delisted either way. */
export async function delistFromShopify(client: ShopifyClient, externalProductId: string): Promise<void> {
  await client.graphql(
    `mutation($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId } }`,
    { input: { id: externalProductId } },
  );
}
