"use client";

import { useState } from "react";
import { processReturn } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export type OrderWithItems = {
  id: string;
  total_cents: number;
  status: string;
  created_at: string;
  order_items: {
    id: string;
    inventory_item_id: string | null;
    card_name: string;
    quantity: number;
    unit_price_cents: number;
  }[];
};

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

export function ReturnsForm({ orders }: { orders: OrderWithItems[] }) {
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ refundAmountCents: number } | null>(null);
  const [processing, setProcessing] = useState(false);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) ?? null;

  function selectOrder(orderId: string) {
    setSelectedOrderId(orderId);
    setReturnQuantities({});
    setError(null);
    setSuccess(null);
  }

  function setQuantity(orderItemId: string, maxQuantity: number, value: number) {
    setReturnQuantities((prev) => ({
      ...prev,
      [orderItemId]: Math.max(0, Math.min(maxQuantity, value)),
    }));
  }

  async function handleSubmit() {
    if (!selectedOrder) return;
    setError(null);
    setSuccess(null);

    const items = selectedOrder.order_items
      .filter((oi) => oi.inventory_item_id !== null)
      .map((oi) => ({
        inventoryItemId: oi.inventory_item_id as string,
        quantity: returnQuantities[oi.id] ?? 0,
      }))
      .filter((i) => i.quantity > 0);

    if (items.length === 0) {
      setError("Select at least one item to return.");
      return;
    }

    setProcessing(true);
    const result = await processReturn({ orderId: selectedOrder.id, items, reason });
    setProcessing(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setSuccess({ refundAmountCents: result.refundAmountCents });
    setReturnQuantities({});
    setReason("");
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <Badge variant="success" data-testid="return-complete">
          Refund processed: ${dollars(success.refundAmountCents)}
        </Badge>
      )}

      <div className="flex flex-col gap-1.5 sm:w-96">
        <Label htmlFor="orderSelect">Order</Label>
        <select id="orderSelect" value={selectedOrderId} onChange={(e) => selectOrder(e.target.value)} className={selectClassName}>
          <option value="">Select an order...</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {new Date(o.created_at).toLocaleString()} - ${dollars(o.total_cents)} ({o.status})
            </option>
          ))}
        </select>
      </div>

      {selectedOrder && (
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul data-testid="return-items" className="flex flex-col gap-2">
              {selectedOrder.order_items.map((item) => (
                <li
                  key={item.id}
                  data-testid="return-item-row"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="text-foreground">
                    {item.card_name} — ${dollars(item.unit_price_cents)} × {item.quantity} purchased
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={`returnQty-${item.id}`} className="text-xs">
                      Return qty
                    </Label>
                    <Input
                      id={`returnQty-${item.id}`}
                      type="number"
                      min={0}
                      max={item.quantity}
                      value={returnQuantities[item.id] ?? 0}
                      onChange={(e) => setQuantity(item.id, item.quantity, Number(e.target.value))}
                      disabled={item.inventory_item_id === null}
                      title={item.inventory_item_id === null ? "Original inventory item was deleted" : undefined}
                      className="h-8 w-20"
                    />
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="returnReason">Reason</Label>
              <Textarea id="returnReason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>

            <div>
              <Button onClick={handleSubmit} disabled={processing}>
                {processing ? "Processing..." : "Process return"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
