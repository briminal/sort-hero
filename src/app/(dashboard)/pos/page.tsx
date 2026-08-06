import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { PosTerminal } from "./pos-terminal";

export default async function PosPage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const { data: openTill } = await supabase
    .from("tills")
    .select("id, name")
    .eq("store_id", storeId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: store } = await supabase.from("stores").select("tax_rate_percent").eq("id", storeId).single();

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Point of Sale</h1>
        <p className="flex gap-3 text-sm">
          <Link href="/pos/tills" className="text-primary hover:underline">
            Manage tills
          </Link>
          <Link href="/pos/returns" className="text-primary hover:underline">
            Returns
          </Link>
        </p>
      </div>

      {!openTill ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          No till is open.{" "}
          <Link href="/pos/tills" className="underline">
            Open a till
          </Link>{" "}
          to start a sale.
        </p>
      ) : (
        <PosTerminal
          tillId={openTill.id}
          tillName={openTill.name}
          taxRatePercent={Number(store?.tax_rate_percent ?? 0)}
          storeId={storeId}
        />
      )}
    </main>
  );
}
