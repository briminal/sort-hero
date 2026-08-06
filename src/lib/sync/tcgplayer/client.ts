import type { SupabaseClient } from "@supabase/supabase-js";

/** TCGplayer's Seller API uses client_credentials OAuth2 (no user-facing
 * redirect) -- exchange the issued key/secret for a bearer token, cached in
 * marketplace_credentials since it must survive across serverless
 * invocations, not just an in-memory singleton like Stripe's client.
 * Dependency-light (plain fetch) for the same Deno-portability reason as
 * the Shopify client. Base URL overridable for mock-server verification. */

export type TcgplayerClient = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

/** Raw token exchange, no DB caching -- used directly by the pre-persist
 * connectivity check in connectTcgplayer, before a connection_id exists to
 * cache against. */
export async function exchangeTcgplayerToken(
  apiKey: string,
  apiSecret: string,
  baseUrl = process.env.TCGPLAYER_API_BASE_URL || "https://api.tcgplayer.com",
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const res = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: apiKey, client_secret: apiSecret }),
  });
  if (!res.ok) throw new Error(`TCGplayer token exchange failed: ${res.status} ${await res.text()}`);

  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: json.access_token, expiresInSeconds: json.expires_in };
}

async function getOrRefreshBearerToken(
  supabase: SupabaseClient,
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
    new Date(creds.tcgplayer_bearer_expires_at as string).getTime() - bufferMs > Date.now()
  ) {
    return creds.tcgplayer_bearer_token as string;
  }

  const { accessToken, expiresInSeconds } = await exchangeTcgplayerToken(apiKey, apiSecret, baseUrl);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  await supabase
    .from("marketplace_credentials")
    .update({ tcgplayer_bearer_token: accessToken, tcgplayer_bearer_expires_at: expiresAt })
    .eq("connection_id", connectionId);

  return accessToken;
}

export async function getTcgplayerClient(
  supabase: SupabaseClient,
  connectionId: string,
  apiKey: string,
  apiSecret: string,
): Promise<TcgplayerClient> {
  const baseUrl = process.env.TCGPLAYER_API_BASE_URL || "https://api.tcgplayer.com";
  const token = await getOrRefreshBearerToken(supabase, connectionId, apiKey, apiSecret, baseUrl);

  return {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init?.headers, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`TCGplayer API error: ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    },
  };
}

/** Connectivity check used by connectTcgplayer -- the token exchange itself
 * is the validation that the submitted key/secret work, run before a
 * connection_id exists to cache the token against. */
export async function verifyTcgplayerConnection(apiKey: string, apiSecret: string): Promise<void> {
  await exchangeTcgplayerToken(apiKey, apiSecret);
}
