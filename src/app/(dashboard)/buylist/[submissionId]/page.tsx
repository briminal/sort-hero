import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { SubmissionDetail, type SubmissionDetailData } from "./submission-detail";

export default async function BuylistSubmissionPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const supabase = await createClient();
  await getMyStore(supabase); // ensures the caller is a store member before proceeding

  const { data, error } = await supabase
    .from("buylist_submissions")
    .select(
      "id, channel, status, total_offer_cents, total_offer_credit_cents, payout_method, created_at, buylist_customers(id, name, email, phone, store_credit_balance_cents), buylist_items(id, card_name, condition, quantity_submitted, quantity_approved, offered_unit_price_cents, offered_credit_price_cents, verified_quantity, sent_to_inventory_at), buylist_messages(id, sender, body, created_at)",
    )
    .eq("id", submissionId)
    .order("created_at", { referencedTable: "buylist_messages", ascending: true })
    .single();

  if (error || !data) {
    return (
      <main className="p-6">
        <Link href="/buylist" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to buylist
        </Link>
        <p role="alert" className="mt-3 text-sm text-destructive">
          Could not load submission: {error?.message ?? "Not found"}
        </p>
      </main>
    );
  }

  return (
    <div>
      <div className="px-6 pt-6">
        <Link href="/buylist" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to buylist
        </Link>
      </div>
      <SubmissionDetail submission={data as unknown as SubmissionDetailData} />
    </div>
  );
}
