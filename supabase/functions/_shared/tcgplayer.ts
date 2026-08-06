// Deno-side mirror of src/lib/sync/tcgplayer/*.ts -- see shopify.ts's note
// on why this is a deliberate small duplication, not a shared import.

// deno-lint-ignore no-explicit-any
export type TcgplayerClient = { request<T>(path: string, init?: RequestInit): Promise<T> };

async function getOrRefreshBearerToken(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  connectionId: string,
  apiKey: string,
  apiSecret: string,
  baseUrl: string,
): Promise<string> {
  const { data: creds } = await supabase
    .from("marketplace_credentials")
    .select("tcgplayer_bearer_token, tcgplayer_bearer_expires_at")
    .eq("connection_id", connectionId)
    .single();

  const bufferMs = 60_000;
  if (
    creds?.tcgplayer_bearer_token &&
    creds.tcgplayer_bearer_expires_at &&
    new Date(creds.tcgplayer_bearer_expires_at).getTime() - bufferMs > Date.now()
  ) {
    return creds.tcgplayer_bearer_token;
  }

  const res = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: apiKey, client_secret: apiSecret }),
  });
  if (!res.ok) throw new Error(`TCGplayer token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();

  const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
  await supabase
    .from("marketplace_credentials")
    .update({ tcgplayer_bearer_token: json.access_token, tcgplayer_bearer_expires_at: expiresAt })
    .eq("connection_id", connectionId);

  return json.access_token;
}

export async function getTcgplayerClient(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  connectionId: string,
  apiKey: string,
  apiSecret: string,
): Promise<TcgplayerClient> {
  const baseUrl = Deno.env.get("TCGPLAYER_API_BASE_URL") || "https://api.tcgplayer.com";
  const token = await getOrRefreshBearerToken(supabase, connectionId, apiKey, apiSecret, baseUrl);

  return {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`TCGplayer API error: ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    },
  };
}

export function parseTcgplayerOrder(payload: {
  orderId: string;
  subtotal: number;
  orderTotal: number;
  buyerName: string | null;
  buyerEmail: string | null;
  shippingAddress: Record<string, unknown> | null;
  items: { sku: string; productName: string; quantity: number; price: number }[];
}) {
  const toCents = (n: number) => Math.round(n * 100);
  return {
    externalOrderId: payload.orderId,
    subtotalCents: toCents(payload.subtotal),
    totalCents: toCents(payload.orderTotal),
    customerName: payload.buyerName,
    customerEmail: payload.buyerEmail,
    shippingAddress: payload.shippingAddress,
    rawPayload: payload as unknown as Record<string, unknown>,
    lines: payload.items.map((item) => ({
      externalListingId: item.sku,
      title: item.productName,
      quantity: item.quantity,
      unitPriceCents: toCents(item.price),
      lineTotalCents: toCents(item.price) * item.quantity,
    })),
  };
}
