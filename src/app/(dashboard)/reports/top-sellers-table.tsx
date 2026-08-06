import { formatDollars, type TopSellerRow } from "@/lib/reports/aggregate";

export function TopSellersTable({ title, rows }: { title: string; rows: TopSellerRow[] }) {
  return (
    <div>
      <h3 className="mb-2 font-semibold text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sales in this date range.</p>
      ) : (
        <table className="w-full text-sm text-foreground">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-2">Card</th>
              <th className="py-1 pr-2">Qty sold</th>
              <th className="py-1">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.cardId} className="border-b border-border last:border-b-0">
                <td className="py-1 pr-2">{row.cardName}</td>
                <td className="py-1 pr-2">{row.quantity}</td>
                <td className="py-1">{formatDollars(row.revenueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
