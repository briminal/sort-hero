"use client";

import { useState } from "react";
import { disconnectShipping, getWebhookUrl } from "./actions";
import type { Address } from "@/types/shipping";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ShippingConnectionRow = {
  id: string;
  provider: "shippo";
  status: "disconnected" | "connected" | "error";
  from_address: Address | null;
  last_error: string | null;
};

function statusVariant(status: string): "success" | "destructive" | "secondary" {
  if (status === "connected") return "success";
  if (status === "error") return "destructive";
  return "secondary";
}

export function ShippoConnectionStatus({ connection }: { connection: ShippingConnectionRow }) {
  const [error, setError] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDisconnect() {
    setError(null);
    setBusy(true);
    const result = await disconnectShipping({ connectionId: connection.id });
    setBusy(false);
    if ("error" in result) setError(result.error);
  }

  async function handleShowWebhookUrl() {
    setError(null);
    const result = await getWebhookUrl({ connectionId: connection.id });
    if ("error" in result) setError(result.error);
    else setWebhookUrl(result.url);
  }

  return (
    <div data-testid="shippo-connection-status" data-status={connection.status} className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div>
        <Badge variant={statusVariant(connection.status)}>{connection.status}</Badge>
      </div>

      {connection.last_error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Last error: {connection.last_error}
        </p>
      )}
      {connection.from_address && (
        <p className="text-sm text-muted-foreground">
          Return address: {connection.from_address.name}, {connection.from_address.street1}, {connection.from_address.city},{" "}
          {connection.from_address.state} {connection.from_address.zip}
        </p>
      )}

      <div>
        <Button size="sm" variant="outline" onClick={handleShowWebhookUrl}>
          Show tracking webhook URL
        </Button>
      </div>
      {webhookUrl && (
        <p className="text-sm text-muted-foreground">
          Paste this URL into Shippo&apos;s dashboard (Settings → Webhooks) to receive tracking updates:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{webhookUrl}</code>
        </p>
      )}

      <div>
        <Button size="sm" variant="outline" onClick={handleDisconnect} disabled={busy}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}
