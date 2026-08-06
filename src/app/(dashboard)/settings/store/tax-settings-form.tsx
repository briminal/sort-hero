"use client";

import { useState } from "react";
import { updateStoreTaxSettings } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ROUNDING_OPTIONS: { value: string; label: string; cents: number | null }[] = [
  { value: "none", label: "No rounding", cents: null },
  { value: "5", label: "Round to nearest $0.05", cents: 5 },
  { value: "10", label: "Round to nearest $0.10", cents: 10 },
  { value: "25", label: "Round to nearest $0.25", cents: 25 },
  { value: "100", label: "Round to nearest $1.00", cents: 100 },
];

function roundingValueFor(cents: number | null): string {
  return ROUNDING_OPTIONS.find((o) => o.cents === cents)?.value ?? "none";
}

export function TaxSettingsForm({
  initialTaxRatePercent,
  initialRoundToNearestCents,
  isOwner,
}: {
  initialTaxRatePercent: number;
  initialRoundToNearestCents: number | null;
  isOwner: boolean;
}) {
  const [taxRatePercent, setTaxRatePercent] = useState(initialTaxRatePercent);
  const [rounding, setRounding] = useState(roundingValueFor(initialRoundToNearestCents));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const result = await updateStoreTaxSettings({
      taxRatePercent,
      roundToNearestCents: ROUNDING_OPTIONS.find((o) => o.value === rounding)?.cents ?? null,
    });
    setSaving(false);
    setMessage("error" in result ? `Error: ${result.error}` : "Saved.");
  }

  if (!isOwner) {
    return (
      <p className="text-sm text-muted-foreground">
        Tax rate: {initialTaxRatePercent}% · Only a store owner can change this.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tax-rate">Default tax rate (%)</Label>
          <Input
            id="tax-rate"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={taxRatePercent}
            onChange={(e) => setTaxRatePercent(Math.max(0, Math.min(100, Number(e.target.value))))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rounding">Total rounding</Label>
          <select
            id="rounding"
            value={rounding}
            onChange={(e) => setRounding(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {ROUNDING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Applies as the default at checkout in POS. Staff can still mark an individual sale tax-exempt.
      </p>
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}
