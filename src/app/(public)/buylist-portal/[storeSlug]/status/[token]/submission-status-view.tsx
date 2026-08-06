"use client";

import { useEffect, useState } from "react";
import { getSubmissionByToken, postCustomerMessage, respondToOffer, type SubmissionStatus } from "../../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function statusVariant(status: string): "success" | "destructive" | "secondary" {
  if (status === "accepted" || status === "completed") return "success";
  if (status === "declined" || status === "cancelled") return "destructive";
  return "secondary";
}

function dollars(cents: number | null) {
  return cents === null ? "-" : (cents / 100).toFixed(2);
}

export function SubmissionStatusView({ token, initialData }: { token: string; initialData: SubmissionStatus }) {
  const [data, setData] = useState(initialData);
  const [messageBody, setMessageBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Customers are anonymous (no RLS grants for anon on buylist tables --
    // see the module plan), so they can't subscribe to postgres_changes the
    // way staff screens do. Polling here is a deliberate, narrow exception
    // to CLAUDE.md's Realtime-not-polling rule, not an oversight.
    const interval = setInterval(async () => {
      const result = await getSubmissionByToken(token);
      if (!("error" in result)) setData(result);
    }, 5000);
    return () => clearInterval(interval);
  }, [token]);

  async function handleSendMessage() {
    if (!messageBody.trim()) return;
    setError(null);
    const result = await postCustomerMessage({ token, body: messageBody });
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setMessageBody("");
    const refreshed = await getSubmissionByToken(token);
    if (!("error" in refreshed)) setData(refreshed);
  }

  async function handleRespond(accept: boolean) {
    setError(null);
    setBusy(true);
    const result = await respondToOffer({ token, accept });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const refreshed = await getSubmissionByToken(token);
    if (!("error" in refreshed)) setData(refreshed);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge data-testid="portal-status" variant={statusVariant(data.status)}>
          {data.status}
        </Badge>
        <span className="text-sm text-muted-foreground">Submitted: {new Date(data.createdAt).toLocaleString()}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul data-testid="portal-status-items" className="flex flex-col gap-1.5 text-sm text-foreground">
            {data.items.map((item, i) => (
              <li key={i}>
                {item.cardName} ({item.condition}) — submitted {item.quantitySubmitted}
                {item.quantityApproved !== null && `, approved ${item.quantityApproved}`} @ cash $
                {dollars(item.offeredUnitPriceCents)} / credit ${dollars(item.offeredCreditPriceCents)}
              </li>
            ))}
          </ul>
          <p data-testid="portal-status-total" className="text-lg font-semibold text-foreground">
            Offer total: ${dollars(data.totalOfferCents)} cash, or ${dollars(data.totalOfferCreditCents)} store credit
          </p>

          {data.status === "priced" && (
            <div className="flex gap-2">
              <Button onClick={() => handleRespond(true)} disabled={busy}>
                Accept offer
              </Button>
              <Button variant="outline" onClick={() => handleRespond(false)} disabled={busy}>
                Decline offer
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chat</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul data-testid="portal-status-chat" className="flex flex-col gap-1.5 text-sm">
            {data.messages.map((m, i) => (
              <li key={i} className="text-foreground">
                <strong className="capitalize">{m.sender}:</strong> {m.body}
              </li>
            ))}
            {data.messages.length === 0 && <li className="text-muted-foreground">No messages yet.</li>}
          </ul>
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="portalMessageBody">Message</Label>
              <Input id="portalMessageBody" value={messageBody} onChange={(e) => setMessageBody(e.target.value)} />
            </div>
            <Button onClick={handleSendMessage}>Send</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
