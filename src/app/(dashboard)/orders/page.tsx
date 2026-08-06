import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function statusVariant(status: string): "success" | "destructive" | "secondary" {
  if (status === "completed" || status === "fulfilled") return "success";
  if (status === "cancelled" || status === "refunded") return "destructive";
  return "secondary";
}

export default async function OrdersPage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const { data: rows, error } = await supabase
    .from("order_queue")
    .select("id, source_type, platform, status, subtotal_cents, total_cents, created_at, customer_name, customer_email")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(100);

  if (error) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-xl font-semibold text-foreground">Orders</h1>
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Could not load orders: {error.message}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Orders</h1>
        <Link href="/settings/shipping" className="text-sm text-primary hover:underline">
          Shipping settings
        </Link>
      </div>

      <Card>
        <CardContent className="pt-4">
          <Table data-testid="order-queue">
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Placed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((row) => (
                <TableRow key={row.id} data-testid="order-queue-row" data-source-type={row.source_type} data-status={row.status}>
                  <TableCell>
                    {row.source_type === "pos" ? (
                      <Link href={`/orders/${row.id}`} className="text-primary hover:underline">
                        POS sale
                      </Link>
                    ) : (
                      <Link href={`/orders/${row.id}`} className="text-primary hover:underline">
                        [{row.platform}] {row.customer_name ?? row.customer_email ?? "Customer"}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>${dollars(row.total_cents)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(row.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(rows ?? []).length === 0 && <p className="py-4 text-sm text-muted-foreground">No orders yet.</p>}
        </CardContent>
      </Card>
    </main>
  );
}
