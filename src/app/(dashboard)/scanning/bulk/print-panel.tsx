"use client";

import { useState } from "react";
import type { BulkRow } from "./bulk-scanner";
import { buildLabelsPdf, type LabelLine } from "@/lib/labels/label-pdf";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ROUNDING_OPTIONS: { value: string; label: string; cents: number | null }[] = [
  { value: "none", label: "No rounding / $0.01", cents: null },
  { value: "10", label: "Round to $0.10", cents: 10 },
  { value: "25", label: "Round to $0.25", cents: 25 },
  { value: "50", label: "Round to $0.50", cents: 50 },
  { value: "100", label: "Round to $1.00", cents: 100 },
];

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function PrintPanel({ rows, priceBasis }: { rows: BulkRow[]; priceBasis: "market" | "low" }) {
  const [mode, setMode] = useState<"labels" | "barcodes">("labels");
  const [rounding, setRounding] = useState("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    setBusy(true);
    try {
      const active = rows.filter((r) => !r.excluded && r.selectedCardId);
      const lines: LabelLine[] = active.map((row) => {
        const candidate = row.candidates.find((c) => c.id === row.selectedCardId);
        const price = priceBasis === "low" ? row.lowPriceCents : row.marketPriceCents;
        return {
          cardName: candidate?.name ?? row.ocrQuery,
          setCode: candidate?.set_name ?? null,
          collectorNumber: candidate?.collector_number ?? null,
          condition: row.condition,
          printing: row.printing,
          priceCents: price,
          sku: `${row.selectedCardId}-${row.condition}-${row.printing}`,
        };
      });

      if (lines.length === 0) {
        setError("No matched cards to print -- resolve ambiguous/unmatched rows first.");
        return;
      }

      const roundingIncrementCents = ROUNDING_OPTIONS.find((o) => o.value === rounding)?.cents ?? null;
      const blob = await buildLabelsPdf(lines, { withBarcodes: mode === "barcodes", roundingIncrementCents });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "labels.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate labels");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Print (Label Size 1.5&quot; x 0.5&quot;)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <select value={mode} onChange={(e) => setMode(e.target.value as "labels" | "barcodes")} className={selectClassName}>
          <option value="labels">Labels</option>
          <option value="barcodes">Labels + Barcodes</option>
        </select>

        <select value={rounding} onChange={(e) => setRounding(e.target.value)} className={selectClassName}>
          {ROUNDING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <Button type="button" onClick={handleDownload} disabled={busy || rows.length === 0}>
          {busy ? "Generating..." : "Download Labels"}
        </Button>
      </CardContent>
    </Card>
  );
}
