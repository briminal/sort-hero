"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  completeSubmission,
  declineSubmission,
  postStaffMessage,
  priceSubmission,
  sendBuylistItemToInventory,
  verifyBuylistItem,
} from "../actions";

export type SubmissionDetailData = {
  id: string;
  channel: "portal" | "pos";
  status: string;
  total_offer_cents: number | null;
  total_offer_credit_cents: number | null;
  payout_method: string | null;
  created_at: string;
  buylist_customers: { id: string; name: string | null; email: string | null; phone: string | null; store_credit_balance_cents: number } | null;
  buylist_items: {
    id: string;
    card_name: string;
    condition: string;
    quantity_submitted: number;
    quantity_approved: number | null;
    offered_unit_price_cents: number;
    offered_credit_price_cents: number | null;
    verified_quantity: number | null;
    sent_to_inventory_at: string | null;
  }[];
  buylist_messages: { id: string; sender: "customer" | "staff"; body: string; created_at: string }[];
};

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "success" | "destructive" | "outline"> = {
  pending: "default",
  priced: "secondary",
  accepted: "outline",
  completed: "success",
  declined: "destructive",
  cancelled: "destructive",
};

function dollars(cents: number | null) {
  return cents === null ? "-" : (cents / 100).toFixed(2);
}

export function SubmissionDetail({ submission }: { submission: SubmissionDetailData }) {
  const [items, setItems] = useState(
    submission.buylist_items.map((item) => ({
      ...item,
      quantityApproved: item.quantity_approved ?? item.quantity_submitted,
      offeredCashPriceCents: item.offered_unit_price_cents,
      offeredCreditPriceCents: item.offered_credit_price_cents ?? item.offered_unit_price_cents,
      verifiedQuantity: item.verified_quantity,
      sentToInventoryAt: item.sent_to_inventory_at,
      verifyInput: item.verified_quantity ?? item.quantity_approved ?? item.quantity_submitted,
    })),
  );
  const [messages, setMessages] = useState(submission.buylist_messages);
  const [messageBody, setMessageBody] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<"cash" | "store_credit">(
    (submission.payout_method as "cash" | "store_credit" | null) ?? "cash",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`buylist-messages-${submission.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "buylist_messages", filter: `submission_id=eq.${submission.id}` },
        (payload) => {
          const row = payload.new as SubmissionDetailData["buylist_messages"][number];
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [submission.id]);

  function updateItem(
    id: string,
    field: "quantityApproved" | "offeredCashPriceCents" | "offeredCreditPriceCents" | "verifyInput",
    value: number,
  ) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: Math.max(0, value) } : i)));
  }

  async function handleVerify(itemId: string, verifyInput: number) {
    setError(null);
    setBusy(true);
    const result = await verifyBuylistItem({ submissionId: submission.id, itemId, verifiedQuantity: verifyInput });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, verifiedQuantity: verifyInput } : i)));
  }

  async function handleSendToInventory(itemId: string) {
    setError(null);
    setBusy(true);
    const result = await sendBuylistItemToInventory({ submissionId: submission.id, itemId });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, sentToInventoryAt: new Date().toISOString() } : i)));
  }

  async function handlePrice() {
    setError(null);
    setBusy(true);
    const result = await priceSubmission({
      submissionId: submission.id,
      items: items.map((i) => ({
        itemId: i.id,
        quantityApproved: i.quantityApproved,
        offeredCashPriceCents: i.offeredCashPriceCents,
        offeredCreditPriceCents: i.offeredCreditPriceCents,
      })),
    });
    setBusy(false);
    if ("error" in result) setError(result.error);
  }

  async function handleComplete() {
    setError(null);
    setBusy(true);
    const result = await completeSubmission({ submissionId: submission.id, payoutMethod });
    setBusy(false);
    if ("error" in result) setError(result.error);
  }

  async function handleDecline() {
    setError(null);
    setBusy(true);
    const result = await declineSubmission({ submissionId: submission.id });
    setBusy(false);
    if ("error" in result) setError(result.error);
  }

  async function handleSendMessage() {
    if (!messageBody.trim()) return;
    setError(null);
    const result = await postStaffMessage({ submissionId: submission.id, body: messageBody });
    if ("error" in result) setError(result.error);
    else setMessageBody("");
  }

  const totalCash = items.reduce((sum, i) => sum + i.quantityApproved * i.offeredCashPriceCents, 0);
  const totalCredit = items.reduce((sum, i) => sum + i.quantityApproved * i.offeredCreditPriceCents, 0);
  const editable = submission.status === "pending";

  return (
    <div className="flex flex-col gap-4 p-6">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">
            {submission.buylist_customers?.name ?? submission.buylist_customers?.email ?? "Walk-in"}
          </h1>
          <Badge data-testid="submission-status" variant={STATUS_BADGE_VARIANT[submission.status] ?? "outline"}>
            {submission.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{new Date(submission.created_at).toLocaleString()}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>
                {submission.buylist_customers?.name ?? "Walk-in"} · {submission.buylist_customers?.email ?? "no email"}
                {submission.buylist_customers?.phone && ` · ${submission.buylist_customers.phone}`}
              </p>
              {submission.buylist_customers && (
                <p className="mt-1">
                  Store credit balance:{" "}
                  <span className="font-medium text-foreground">
                    ${dollars(submission.buylist_customers.store_credit_balance_cents)}
                  </span>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table data-testid="submission-items">
                <TableHeader>
                  <TableRow>
                    <TableHead>Card</TableHead>
                    <TableHead>Approved qty</TableHead>
                    <TableHead>Cash price</TableHead>
                    <TableHead>Credit price</TableHead>
                    {submission.status === "accepted" && <TableHead>Verify &amp; send</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} data-testid="submission-item-row">
                      <TableCell>
                        <p className="font-medium text-foreground">{item.card_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.condition} · submitted {item.quantity_submitted}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Label htmlFor={`qty-${item.id}`} className="sr-only">
                          Approved qty
                        </Label>
                        <Input
                          id={`qty-${item.id}`}
                          type="number"
                          min={0}
                          max={item.quantity_submitted}
                          value={item.quantityApproved}
                          onChange={(e) => updateItem(item.id, "quantityApproved", Number(e.target.value))}
                          disabled={!editable}
                          className="w-20"
                        />
                      </TableCell>
                      <TableCell>
                        <Label htmlFor={`cash-price-${item.id}`} className="sr-only">
                          Cash price ($)
                        </Label>
                        <Input
                          id={`cash-price-${item.id}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={(item.offeredCashPriceCents / 100).toFixed(2)}
                          onChange={(e) => updateItem(item.id, "offeredCashPriceCents", Math.round(Number(e.target.value) * 100))}
                          disabled={!editable}
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Label htmlFor={`credit-price-${item.id}`} className="sr-only">
                          Store credit price ($)
                        </Label>
                        <Input
                          id={`credit-price-${item.id}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={(item.offeredCreditPriceCents / 100).toFixed(2)}
                          onChange={(e) => updateItem(item.id, "offeredCreditPriceCents", Math.round(Number(e.target.value) * 100))}
                          disabled={!editable}
                          className="w-24"
                        />
                      </TableCell>

                      {submission.status === "accepted" && (
                        <TableCell>
                          <div data-testid="submission-item-verify" className="flex items-center gap-2">
                            {item.sentToInventoryAt ? (
                              <Badge data-testid="item-sent-badge" variant="success">
                                Sent ({item.verifiedQuantity})
                              </Badge>
                            ) : (
                              <>
                                <Label htmlFor={`verify-${item.id}`} className="sr-only">
                                  Verified qty
                                </Label>
                                <Input
                                  id={`verify-${item.id}`}
                                  type="number"
                                  min={0}
                                  max={item.quantityApproved}
                                  value={item.verifyInput}
                                  onChange={(e) => updateItem(item.id, "verifyInput", Number(e.target.value))}
                                  className="w-16"
                                />
                                <Button variant="outline" size="sm" onClick={() => handleVerify(item.id, item.verifyInput)} disabled={busy}>
                                  Verify
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleSendToInventory(item.id)}
                                  disabled={busy || item.verifiedQuantity === null}
                                >
                                  Send
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
            <CardFooter className="flex-col items-start gap-3 border-t border-border pt-4">
              <p data-testid="submission-total" className="text-sm font-medium">
                Total offer: ${dollars(totalCash)} cash, or ${dollars(totalCredit)} store credit
              </p>

              <div className="flex flex-wrap items-center gap-2">
                {submission.status === "pending" && (
                  <Button onClick={handlePrice} disabled={busy}>
                    Send offer to customer
                  </Button>
                )}

                {submission.status === "accepted" && (
                  <div className="flex items-center gap-2">
                    <Select value={payoutMethod} onValueChange={(v) => setPayoutMethod(v as "cash" | "store_credit")}>
                      <SelectTrigger id="payoutMethod" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="store_credit">Store credit</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={handleComplete} disabled={busy}>
                      Confirm received, complete
                    </Button>
                  </div>
                )}

                {["pending", "priced"].includes(submission.status) && (
                  <Button variant="destructive" onClick={handleDecline} disabled={busy}>
                    Decline
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>
        </div>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Chat</CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <ul data-testid="submission-chat" className="flex flex-col gap-2">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "max-w-[85%] rounded-md px-3 py-2 text-sm",
                    m.sender === "staff" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  <p className="mb-0.5 text-xs opacity-70">{m.sender}</p>
                  {m.body}
                </li>
              ))}
              {messages.length === 0 && <li className="text-sm text-muted-foreground">No messages yet.</li>}
            </ul>
          </CardContent>
          <CardFooter className="gap-2 border-t border-border pt-4">
            <Label htmlFor="messageBody" className="sr-only">
              Message
            </Label>
            <Input
              id="messageBody"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Write a message..."
            />
            <Button onClick={handleSendMessage}>Send</Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
