/** Shopify Admin GraphQL client. Per-connection (not a module-level
 * singleton like getStripe()) since credentials are per-store. Reads its
 * base URL from SHOPIFY_API_BASE_URL so verification can point this at a
 * local mock server without changing any call sites -- only the base URL
 * differs from a real deployment. Deliberately dependency-light (plain
 * fetch, no Node-only APIs) so this file's logic can be mirrored into
 * supabase/functions/_shared/ for the Deno-side bulk-push Edge Function
 * without behavior drift. */

const API_VERSION = "2024-10";

export type ShopifyClient = {
  shopDomain: string;
  graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
};

export function getShopifyClient(shopDomain: string, accessToken: string): ShopifyClient {
  const baseUrl = process.env.SHOPIFY_API_BASE_URL || `https://${shopDomain}`;

  return {
    shopDomain,
    async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      const res = await fetch(`${baseUrl}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!res.ok) {
        throw new Error(`Shopify API error: ${res.status} ${await res.text()}`);
      }

      const json = (await res.json()) as { data?: T; errors?: unknown };
      if (json.errors) {
        throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
      }
      if (!json.data) {
        throw new Error("Shopify GraphQL response had no data");
      }
      return json.data;
    },
  };
}

/** Connectivity check used by connectShopify -- also doubles as validating
 * the submitted token actually works before anything is persisted. */
export async function verifyShopifyConnection(client: ShopifyClient): Promise<{ shopName: string }> {
  const data = await client.graphql<{ shop: { name: string } }>(`{ shop { name } }`);
  return { shopName: data.shop.name };
}
