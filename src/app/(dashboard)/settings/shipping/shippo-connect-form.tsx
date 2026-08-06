"use client";

import { useState } from "react";
import { connectShippo } from "./actions";
import type { Address } from "@/types/shipping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMPTY_ADDRESS: Address = {
  name: "",
  street1: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
  email: "",
  phone: "",
};

export function ShippoConnectForm() {
  const [apiKey, setApiKey] = useState("");
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateField<K extends keyof Address>(field: K, value: Address[K]) {
    setAddress((prev) => ({ ...prev, [field]: value }));
  }

  async function handleConnect() {
    setError(null);
    setBusy(true);
    const result = await connectShippo({ apiKey, fromAddress: address });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      setApiKey("");
    }
  }

  return (
    <div data-testid="shippo-connect-form" className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-sm text-muted-foreground">Connect Shippo to purchase shipping labels for marketplace orders.</p>

      <div className="flex flex-col gap-1.5 sm:w-80">
        <Label htmlFor="shippoApiKey">Shippo API key</Label>
        <Input id="shippoApiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Return address</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fromName">Name / business name</Label>
            <Input id="fromName" value={address.name} onChange={(e) => updateField("name", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fromStreet1">Street</Label>
            <Input id="fromStreet1" value={address.street1} onChange={(e) => updateField("street1", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fromCity">City</Label>
            <Input id="fromCity" value={address.city} onChange={(e) => updateField("city", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fromState">State</Label>
            <Input id="fromState" value={address.state} onChange={(e) => updateField("state", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fromZip">ZIP</Label>
            <Input id="fromZip" value={address.zip} onChange={(e) => updateField("zip", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fromEmail">Email (required by some carriers)</Label>
            <Input id="fromEmail" type="email" value={address.email ?? ""} onChange={(e) => updateField("email", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fromPhone">Phone (required by some carriers)</Label>
            <Input id="fromPhone" value={address.phone ?? ""} onChange={(e) => updateField("phone", e.target.value)} />
          </div>
        </div>
      </div>

      <div>
        <Button onClick={handleConnect} disabled={busy}>
          {busy ? "Connecting..." : "Connect Shippo"}
        </Button>
      </div>
    </div>
  );
}
