"use client";

import { useState } from "react";
import { connectTcgplayer } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TcgplayerConnectForm() {
  const [storeKey, setStoreKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    setError(null);
    setBusy(true);
    const result = await connectTcgplayer({ storeKey, apiKey, apiSecret });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      setApiKey("");
      setApiSecret("");
    }
  }

  return (
    <div data-testid="tcgplayer-connect-form" className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Enter the API key/secret issued after your TCGplayer Seller API application is approved.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tcgplayerStoreKey">Store key</Label>
          <Input id="tcgplayerStoreKey" value={storeKey} onChange={(e) => setStoreKey(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tcgplayerApiKey">API key</Label>
          <Input id="tcgplayerApiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tcgplayerApiSecret">API secret</Label>
          <Input id="tcgplayerApiSecret" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} />
        </div>
      </div>

      <div>
        <Button onClick={handleConnect} disabled={busy}>
          {busy ? "Connecting..." : "Connect TCGplayer"}
        </Button>
      </div>
    </div>
  );
}
