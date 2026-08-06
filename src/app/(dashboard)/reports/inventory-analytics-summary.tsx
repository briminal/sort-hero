import { formatDollars } from "@/lib/reports/aggregate";
import type { Breakdown, InventoryAnalytics } from "@/lib/reports/inventory-analytics";

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }) {
  return (
    <div>
      <h4 className="mb-1 text-sm font-medium text-foreground">{title}</h4>
      <table className="w-full text-sm text-foreground">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border last:border-b-0">
              <td className="py-1 pr-2">{row.key}</td>
              <td className="py-1 pr-2">{row.quantity}</td>
              <td className="py-1">{formatDollars(row.retailValueCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryAnalyticsSummary({ analytics }: { analytics: InventoryAnalytics }) {
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Total on-hand</p>
          <p className="text-lg font-semibold text-foreground">{analytics.totalQuantity}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Retail value</p>
          <p className="text-lg font-semibold text-foreground">{formatDollars(analytics.retailValueCents)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Cost value (known)</p>
          <p className="text-lg font-semibold text-foreground">{formatDollars(analytics.costValueCents)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Unknown cost</p>
          <p className="text-lg font-semibold text-foreground">{analytics.unknownCostQuantity} units</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <BreakdownTable title="By status" rows={analytics.byStatus} />
        <BreakdownTable title="By condition" rows={analytics.byCondition} />
        <BreakdownTable title="By game" rows={analytics.byGame} />
      </div>
    </div>
  );
}
