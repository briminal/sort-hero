"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function statusVariant(status: string): "success" | "destructive" | "secondary" {
  if (status === "completed") return "success";
  if (status === "cancelled" || status === "refunded") return "destructive";
  return "secondary";
}

export type PosOrderDetail = {
  id: string;
  status: string;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  tax_exempt: boolean;
  total_cents: number;
  created_at: string;
  tills: { name: string } | { name: string }[] | null;
  order_items: {
    card_name: string;
    quantity: number;
    unit_price_cents: number;
    line_total_cents: number;
    taxable: boolean;
    deduct_inventory: boolean;
  }[];
  payments: { method: string; amount_cents: number; status: string; created_at: string }[];
  refunds: { amount_cents: number; reason: string | null; created_at: string }[];
};

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

export function PosInvoice({ order }: { order: PosOrderDetail }) {
  const till = Array.isArray(order.tills) ? order.tills[0] : order.tills;
  const paidCents = order.payments.filter((p) => p.status === "succeeded").reduce((sum, p) => sum + p.amount_cents, 0);
  const refundedCents = order.refunds.reduce((sum, r) => sum + r.amount_cents, 0);

  return (
    <div className="flex flex-col gap-4 print:gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Badge data-testid="order-status" variant={statusVariant(order.status)}>
            {order.status}
          </Badge>
          <span className="text-sm text-muted-foreground">Till: {till?.name ?? "—"}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          Print Receipt
        </Button>
      </div>

      <div className="hidden print:block">
        <p className="text-lg font-semibold">Receipt — Order {order.id}</p>
        <p className="text-sm">{new Date(order.created_at).toLocaleString()}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table data-testid="pos-invoice-items">
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.order_items.map((item, i) => (
                <TableRow key={i}>
                  <TableCell>
                    {item.card_name}
                    {!item.taxable && <span className="text-muted-foreground"> (non-taxable)</span>}
                  </TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>${dollars(item.unit_price_cents)}</TableCell>
                  <TableCell>${dollars(item.line_total_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-col items-end gap-0.5 text-sm text-muted-foreground">
            <span>Subtotal: ${dollars(order.subtotal_cents)}</span>
            {order.discount_cents > 0 && <span>Discount: -${dollars(order.discount_cents)}</span>}
            <span>Tax {order.tax_exempt ? "(exempt)" : ""}: ${dollars(order.tax_cents)}</span>
            <span className="text-base font-semibold text-foreground">Total: ${dollars(order.total_cents)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          {order.payments.length === 0 && <p className="text-muted-foreground">No payments recorded.</p>}
          {order.payments.map((p, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="capitalize text-foreground">{p.method.replace("_", " ")}</span>
              <span>
                ${dollars(p.amount_cents)} <span className="text-muted-foreground">({p.status})</span>
              </span>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-border pt-1 font-medium text-foreground">
            <span>Paid</span>
            <span>${dollars(paidCents)}</span>
          </div>
          {refundedCents > 0 && (
            <div className="flex items-center justify-between text-destructive">
              <span>Refunded</span>
              <span>${dollars(refundedCents)}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
