import { formatDollars, type MarginSummary } from "@/lib/reports/aggregate";

export function MarginSummaryPanel({ summary }: { summary: MarginSummary }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div>
        <p className="text-xs text-muted-foreground">Revenue</p>
        <p className="text-lg font-semibold text-foreground">{formatDollars(summary.revenueCents)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Known cost</p>
        <p className="text-lg font-semibold text-foreground">{formatDollars(summary.knownCostCents)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Margin (known-cost sales)</p>
        <p className="text-lg font-semibold text-foreground">{formatDollars(summary.marginCents)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Excluded (unknown cost)</p>
        <p className="text-lg font-semibold text-foreground">
          {formatDollars(summary.unknownCostRevenueCents)}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            ({summary.unknownCostLineCount} line{summary.unknownCostLineCount === 1 ? "" : "s"})
          </span>
        </p>
      </div>
    </div>
  );
}
