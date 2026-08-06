"use client";

import { priceCentsFor, type BulkRow } from "./bulk-scanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function StatisticsPanel({
  rows,
  priceBasis,
  onPriceBasisChange,
  thresholdCents,
  onThresholdCentsChange,
  onSaveThreshold,
  savingThreshold,
  confidenceThresholdPct,
  onConfidenceThresholdPctChange,
}: {
  rows: BulkRow[];
  priceBasis: "market" | "low";
  onPriceBasisChange: (basis: "market" | "low") => void;
  thresholdCents: number;
  onThresholdCentsChange: (cents: number) => void;
  onSaveThreshold: () => void;
  savingThreshold: boolean;
  confidenceThresholdPct: number;
  onConfidenceThresholdPctChange: (pct: number) => void;
}) {
  const activeRows = rows.filter((r) => !r.excluded && r.selectedCardId);

  const totalApproved = rows.filter((r) => r.reviewState === "approved").length;
  const totalErrors = rows.filter(
    (r) => (r.status === "unmatched" && !r.selectedCardId) || (r.confidence !== null && r.confidence * 100 < confidenceThresholdPct),
  ).length;

  let highValueTotalCents = 0;
  let highValueQuantity = 0;
  let bulkTotalCents = 0;
  let bulkQuantity = 0;

  for (const row of activeRows) {
    const price = priceCentsFor(row, priceBasis);
    if (price === null) continue;
    if (price >= thresholdCents) {
      highValueTotalCents += price * row.quantity;
      highValueQuantity += row.quantity;
    } else {
      bulkTotalCents += price * row.quantity;
      bulkQuantity += row.quantity;
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Statistics</CardTitle>
        <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
          <button
            type="button"
            onClick={() => onPriceBasisChange("market")}
            className={`px-2 py-1 font-medium ${priceBasis === "market" ? "bg-primary text-primary-foreground" : "bg-background"}`}
          >
            Market
          </button>
          <button
            type="button"
            onClick={() => onPriceBasisChange("low")}
            className={`px-2 py-1 font-medium ${priceBasis === "low" ? "bg-primary text-primary-foreground" : "bg-background"}`}
          >
            Low
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-muted-foreground">Total Cards</p>
            <p className="font-semibold text-foreground">{rows.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Approved</p>
            <p className="font-semibold text-foreground">{totalApproved}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Errors</p>
            <p className="font-semibold text-destructive">{totalErrors}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
          <div>
            <p className="text-xs text-muted-foreground">High Value Total</p>
            <p className="font-semibold text-primary">{dollars(highValueTotalCents)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">High Value Quantity</p>
            <p className="font-semibold text-foreground">{highValueQuantity}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Bulk Total</p>
            <p className="font-semibold text-foreground">{dollars(bulkTotalCents)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Bulk Quantity</p>
            <p className="font-semibold text-foreground">{bulkQuantity}</p>
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">Grand Total</p>
          <p className="text-lg font-semibold text-foreground">{dollars(highValueTotalCents + bulkTotalCents)}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stats-threshold">High Value Threshold ($)</Label>
            <div className="flex gap-1.5">
              <Input
                id="stats-threshold"
                type="number"
                min={0}
                step="0.01"
                value={(thresholdCents / 100).toFixed(2)}
                onChange={(e) => onThresholdCentsChange(Math.round(Number(e.target.value) * 100))}
                className="h-9"
              />
              <Button type="button" variant="outline" size="sm" onClick={onSaveThreshold} disabled={savingThreshold}>
                {savingThreshold ? "..." : "Save"}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stats-confidence">Confidence Threshold (%)</Label>
            <Input
              id="stats-confidence"
              type="number"
              min={0}
              max={100}
              value={confidenceThresholdPct}
              onChange={(e) => onConfidenceThresholdPctChange(Math.max(0, Math.min(100, Number(e.target.value))))}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
