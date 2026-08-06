import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { CheckoutMessageEditor, type CheckoutConfig } from "./checkout-message-editor";

export default async function BuylistCheckoutMessagePage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const { data, error } = await supabase
    .from("buylist_checkout_config")
    .select(
      "checkout_message, cash_incentive_message, credit_incentive_message, terms_text, require_terms_acceptance, drop_in_enabled, drop_in_message, delivery_enabled, delivery_message, address_acknowledgment_message",
    )
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-lg font-semibold">Buylist checkout messaging</h1>
        <p role="alert" className="mt-2 text-sm text-destructive">
          Could not load checkout messaging: {error.message}
        </p>
      </main>
    );
  }

  const initialConfig: CheckoutConfig = {
    checkoutMessage: data?.checkout_message ?? "",
    cashIncentiveMessage: data?.cash_incentive_message ?? "",
    creditIncentiveMessage: data?.credit_incentive_message ?? "",
    termsText: data?.terms_text ?? "",
    requireTermsAcceptance: data?.require_terms_acceptance ?? false,
    dropInEnabled: data?.drop_in_enabled ?? true,
    dropInMessage: data?.drop_in_message ?? "",
    deliveryEnabled: data?.delivery_enabled ?? true,
    deliveryMessage: data?.delivery_message ?? "",
    addressAcknowledgmentMessage: data?.address_acknowledgment_message ?? "",
  };

  return (
    <main className="flex flex-col gap-4 p-6">
      <div>
        <Link href="/buylist" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to buylist
        </Link>
        <h1 className="mt-2 text-lg font-semibold">Checkout messaging</h1>
        <p className="text-sm text-muted-foreground">
          Configure what customers see on the public buylist portal when they review and submit their cards.
        </p>
      </div>
      <CheckoutMessageEditor initialConfig={initialConfig} />
    </main>
  );
}
