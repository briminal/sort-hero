import type { TcgplayerClient } from "./client";
import { parseTcgplayerOrder } from "./parse-order";
import type { RawSyncOrder } from "../types";

/** Polling, not webhooks -- see parse-order.ts's caveat. Filtered by a
 * `since` cursor so a job that runs every N minutes only pulls what's new,
 * mirroring the cursor stored on marketplace_connections.last_synced_at. */
export async function fetchNewTcgplayerOrders(
  client: TcgplayerClient,
  storeKey: string,
  sinceIso: string | null,
): Promise<RawSyncOrder[]> {
  const query = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : "";
  const data = await client.request<{ orders: Parameters<typeof parseTcgplayerOrder>[0][] }>(
    `/order/${storeKey}/orders${query}`,
  );
  return data.orders.map(parseTcgplayerOrder);
}
