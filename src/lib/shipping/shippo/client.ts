import type { Address } from "@/types/shipping";

/** Shippo REST client. Per-connection (not a module-level singleton like
 * getStripe()) since the API key is per-store. Base URL overridable via
 * SHIPPO_API_BASE_URL for verification against a mock; unset in production
 * hits the real API. Request/response shapes here are confirmed against
 * Shippo's real test-mode API (not guessed) -- unlike Shopify/TCGplayer in
 * Module #9, real credentials were available for this module. */

const BASE_URL = () => process.env.SHIPPO_API_BASE_URL || "https://api.goshippo.com";

// Thrown when the fetch() call itself never got a response (network drop,
// timeout, DNS failure) -- as opposed to Shippo responding with an explicit
// non-2xx status. This distinction matters for label purchase: an explicit
// rejection means nothing was charged, safe to retry; a transport failure
// means Shippo may have received and processed the request anyway, so we
// genuinely don't know whether a label/charge already exists.
export class ShippoTransportError extends Error {}

export type ShippoClient = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

export function getShippoClient(apiKey: string): ShippoClient {
  return {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      let res: Response;
      try {
        res = await fetch(`${BASE_URL()}${path}`, {
          ...init,
          headers: {
            Authorization: `ShippoToken ${apiKey}`,
            "Content-Type": "application/json",
            ...init?.headers,
          },
        });
      } catch (err) {
        throw new ShippoTransportError(err instanceof Error ? err.message : "Shippo request failed");
      }
      if (!res.ok) {
        throw new Error(`Shippo API error: ${res.status} ${await res.text()}`);
      }
      return (await res.json()) as T;
    },
  };
}

/** Connectivity check used by connectShippo -- a cheap, side-effect-free
 * GET, confirmed to 401 on an invalid key against the real API. */
export async function verifyShippoConnection(client: ShippoClient): Promise<void> {
  await client.request("/carrier_accounts/");
}

export type ShippoRate = {
  objectId: string;
  provider: string;
  serviceLevelName: string;
  amountCents: number;
  currency: string;
  estimatedDays: number | null;
};

export type ShippoShipmentResult =
  | { ok: true; shipmentId: string; rates: ShippoRate[] }
  | { ok: false; error: string };

function toCents(amountString: string): number {
  return Math.round(Number(amountString) * 100);
}

/** Creates a Shippo shipment (from/to address + parcel) and returns its
 * quoted rates. Uses a fixed small-parcel default sized for shipped cards --
 * see the module plan's stated scope (no custom parcel config this pass). */
export async function getShippoRates(
  client: ShippoClient,
  fromAddress: Address,
  toAddress: Address,
): Promise<ShippoShipmentResult> {
  try {
    const data = await client.request<{
      object_id: string;
      status: string;
      messages: { source: string; text: string }[];
      rates: {
        object_id: string;
        provider: string;
        servicelevel: { name: string };
        amount: string;
        currency: string;
        estimated_days: number | null;
      }[];
    }>("/shipments/", {
      method: "POST",
      body: JSON.stringify({
        address_from: fromAddress,
        address_to: toAddress,
        parcels: [{ length: "6", width: "4", height: "1", distance_unit: "in", weight: "2", mass_unit: "oz" }],
        async: false,
      }),
    });

    if (data.status !== "SUCCESS" || data.rates.length === 0) {
      return { ok: false, error: data.messages.map((m) => m.text).join("; ") || "No shipping rates available" };
    }

    return {
      ok: true,
      shipmentId: data.object_id,
      rates: data.rates.map((r) => ({
        objectId: r.object_id,
        provider: r.provider,
        serviceLevelName: r.servicelevel.name,
        amountCents: toCents(r.amount),
        currency: r.currency,
        estimatedDays: r.estimated_days,
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not get shipping rates" };
  }
}

export type ShippoShipmentDetail = {
  objectId: string;
  addressToZip: string;
  rates: ShippoRate[];
};

/** Re-fetches a previously-created shipment (address + rates), used to
 * verify a client-round-tripped rate id actually belongs to the shipment
 * quoted for THIS order (and to derive the real carrier/service/amount
 * server-side) rather than trusting client-supplied strings -- see
 * purchaseLabel's use of this. */
export async function getShippoShipment(client: ShippoClient, shipmentId: string): Promise<ShippoShipmentDetail> {
  const data = await client.request<{
    object_id: string;
    address_to: { zip: string };
    rates: {
      object_id: string;
      provider: string;
      servicelevel: { name: string };
      amount: string;
      currency: string;
      estimated_days: number | null;
    }[];
  }>(`/shipments/${shipmentId}`);

  return {
    objectId: data.object_id,
    addressToZip: data.address_to.zip,
    rates: data.rates.map((r) => ({
      objectId: r.object_id,
      provider: r.provider,
      serviceLevelName: r.servicelevel.name,
      amountCents: toCents(r.amount),
      currency: r.currency,
      estimatedDays: r.estimated_days,
    })),
  };
}

export type PurchaseLabelResult =
  | {
      ok: true;
      transactionId: string;
      trackingNumber: string;
      trackingUrl: string;
      labelUrl: string;
      carrierName: string;
      serviceLevel: string;
    }
  | { ok: false; error: string };

export async function purchaseShippoLabel(
  client: ShippoClient,
  rateId: string,
  carrierName: string,
  serviceLevel: string,
): Promise<PurchaseLabelResult> {
  try {
    const data = await client.request<{
      object_id: string;
      status: string;
      tracking_number: string;
      tracking_url_provider: string;
      label_url: string;
      messages: { source: string; text: string }[];
    }>("/transactions/", {
      method: "POST",
      body: JSON.stringify({ rate: rateId, label_file_type: "PDF", async: false }),
    });

    if (data.status !== "SUCCESS") {
      return { ok: false, error: data.messages.map((m) => m.text).join("; ") || "Label purchase failed" };
    }

    return {
      ok: true,
      transactionId: data.object_id,
      trackingNumber: data.tracking_number,
      trackingUrl: data.tracking_url_provider,
      labelUrl: data.label_url,
      carrierName,
      serviceLevel,
    };
  } catch (err) {
    // A ShippoTransportError means we never got a response -- Shippo may
    // have processed (and charged) the request anyway. Left to propagate
    // uncaught rather than folded into the {ok:false} shape below, so the
    // caller can tell "safe to retry" apart from "unknown, don't retry
    // blindly" and handle the shipment claim differently for each.
    if (err instanceof ShippoTransportError) throw err;
    return { ok: false, error: err instanceof Error ? err.message : "Could not purchase label" };
  }
}
