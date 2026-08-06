"use client";

import { useState } from "react";
import { getShippingRates, purchaseLabel } from "../actions";
import type { ShippoRate } from "@/lib/shipping/shippo/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function statusVariant(status: string): "success" | "destructive" | "secondary" {
  if (status === "completed" || status === "fulfilled" || status === "delivered" || status === "label_created" || status === "in_transit") return "success";
  if (status === "cancelled" || status === "refunded") return "destructive";
  return "secondary";
}

export type MarketplaceOrderDetail = {
  id: string;
  platform: string;
  status: string;
  subtotal_cents: number;
  total_cents: number;
  customer_name: string | null;
  customer_email: string | null;
  shipping_address: Record<string, unknown> | null;
  created_at: string;
  marketplace_order_items: { card_name: string; quantity: number; unit_price_cents: number; line_total_cents: number }[];
  shipments: {
    id: string;
    tracking_number: string | null;
    tracking_url: string | null;
    label_url: string | null;
    carrier_name: string | null;
    service_level: string | null;
    status: string;
    tracking_push_error: string | null;
  }[];
};

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

export function LabelPurchase({ order }: { order: MarketplaceOrderDetail }) {
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [rates, setRates] = useState<ShippoRate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [purchased, setPurchased] = useState<{ trackingNumber: string; labelUrl: string } | null>(null);

  const existingShipment = order.shipments[0] ?? null;

  async function handleGetRates() {
    setError(null);
    setBusy(true);
    const result = await getShippingRates({ marketplaceOrderId: order.id });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setShipmentId(result.shipmentId);
    setRates(result.rates);
  }

  async function handleBuyLabel(rate: ShippoRate) {
    if (!shipmentId) return;
    setError(null);
    setBusy(true);
    const result = await purchaseLabel({
      marketplaceOrderId: order.id,
      shipmentId,
      rateObjectId: rate.objectId,
    });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setPurchased({ trackingNumber: result.trackingNumber, labelUrl: result.labelUrl });
    setRates(null);
    setShipmentId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge data-testid="order-status" variant={statusVariant(order.status)}>
          {order.status}
        </Badge>
        <span className="text-sm text-muted-foreground">Customer: {order.customer_name ?? order.customer_email ?? "Unknown"}</span>
      </div>
      {order.shipping_address && (
        <p className="text-sm text-muted-foreground">Ship to: {JSON.stringify(order.shipping_address)}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <ul className="flex flex-col gap-1.5 text-sm text-foreground">
            {order.marketplace_order_items.map((item, i) => (
              <li key={i}>
                {item.card_name} × {item.quantity} @ ${dollars(item.unit_price_cents)} = ${dollars(item.line_total_cents)}
              </li>
            ))}
          </ul>
          <p className="text-lg font-semibold text-foreground">Total: ${dollars(order.total_cents)}</p>
        </CardContent>
      </Card>

      {existingShipment ? (
        <Card data-testid="existing-shipment">
          <CardHeader>
            <CardTitle>Shipment</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-foreground">Tracking: {existingShipment.tracking_number}</p>
            {existingShipment.tracking_url && (
              <a href={existingShipment.tracking_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Track package
              </a>
            )}
            {existingShipment.label_url && (
              <a href={existingShipment.label_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Download label
              </a>
            )}
            <p className="text-muted-foreground">
              Carrier: {existingShipment.carrier_name} — {existingShipment.service_level}
            </p>
            {existingShipment.tracking_push_error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                Tracking wasn&apos;t pushed to {order.platform}: {existingShipment.tracking_push_error}
              </p>
            )}
          </CardContent>
        </Card>
      ) : purchased ? (
        <Card data-testid="label-purchase-complete">
          <CardContent className="flex flex-col gap-2 pt-4 text-sm">
            <p className="text-foreground">Label purchased. Tracking: {purchased.trackingNumber}</p>
            <a href={purchased.labelUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              Download label
            </a>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Shipping</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!rates && (
              <div>
                <Button onClick={handleGetRates} disabled={busy}>
                  {busy ? "Getting rates..." : "Get rates"}
                </Button>
              </div>
            )}
            {rates && (
              <ul data-testid="shipping-rates" className="flex flex-col gap-1.5">
                {rates.map((rate) => (
                  <li key={rate.objectId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <span className="text-foreground">
                      {rate.provider} {rate.serviceLevelName} — ${dollars(rate.amountCents)}
                    </span>
                    <Button size="sm" onClick={() => handleBuyLabel(rate)} disabled={busy}>
                      Buy label
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
