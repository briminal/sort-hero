import Link from "next/link";
import { Settings2, MessageSquareText, HandCoins } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { Button } from "@/components/ui/button";
import { QueueBoard, type SubmissionRow } from "./queue-board";

export default async function BuylistPage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const { data, error } = await supabase
    .from("buylist_submissions")
    .select("id, channel, status, total_offer_cents, total_offer_credit_cents, created_at, buylist_customers(name, email)")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(100);

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-lg font-semibold">Buylist</h1>
        <p role="alert" className="mt-2 text-sm text-destructive">
          Could not load submissions: {error.message}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Buylist</h1>
          <p className="text-sm text-muted-foreground">Track incoming submissions from the portal and in-person buys.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/buylist/pricing">
              <Settings2 />
              Buy pricing rules
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/buylist/checkout-message">
              <MessageSquareText />
              Checkout messaging
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/pos/buy">
              <HandCoins />
              In-person buy
            </Link>
          </Button>
        </div>
      </div>

      <QueueBoard storeId={storeId} initialSubmissions={(data ?? []) as unknown as SubmissionRow[]} />
    </main>
  );
}
