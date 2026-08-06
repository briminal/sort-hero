"use client";

import { useState } from "react";
import { connectShopify } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ShopifyConnectForm() {
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    setError(null);
    setBusy(true);
    const result = await connectShopify({ shopDomain, accessToken, webhookSecret });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      // Don't leave secrets sitting in state/DOM after a failed attempt --
      // a successful connect unmounts this form entirely, so this only
      // matters on the error path.
      setAccessToken("");
      setWebhookSecret("");
    }
  }

  return (
    <div data-testid="shopify-connect-form" className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Create a custom app in your Shopify admin to get an Admin API access token and webhook secret.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shopDomain">Shop domain</Label>
          <Input
            id="shopDomain"
            value={shopDomain}
            onChange={(e) => setShopDomain(e.target.value)}
            placeholder="my-shop.myshopify.com"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shopifyAccessToken">Admin API access token</Label>
          <Input id="shopifyAccessToken" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shopifyWebhookSecret">Webhook secret</Label>
          <Input id="shopifyWebhookSecret" type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
        </div>
      </div>

      <div>
        <Button onClick={handleConnect} disabled={busy}>
          {busy ? "Connecting..." : "Connect Shopify"}
        </Button>
      </div>
    </div>
  );
}
