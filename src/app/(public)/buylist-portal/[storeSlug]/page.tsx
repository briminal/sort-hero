import { getServiceClient } from "@/lib/supabase/service";
import { getActiveGamesQuery } from "@/lib/games";
import { PortalForm, type CheckoutMessagingConfig } from "./portal-form";

export default async function BuylistPortalStorePage({
  params,
}: {
  params: Promise<{ storeSlug: string }>;
}) {
  const { storeSlug } = await params;
  const supabase = getServiceClient();
  const games = await getActiveGamesQuery(supabase);

  const { data: store } = await supabase.from("stores").select("id").eq("slug", storeSlug).maybeSingle();

  let checkoutConfig: CheckoutMessagingConfig = {
    checkoutMessage: null,
    cashIncentiveMessage: null,
    creditIncentiveMessage: null,
    termsText: null,
    requireTermsAcceptance: false,
    dropInEnabled: true,
    dropInMessage: null,
    deliveryEnabled: true,
    deliveryMessage: null,
    addressAcknowledgmentMessage: null,
  };
  if (store) {
    const { data } = await supabase
      .from("buylist_checkout_config")
      .select(
        "checkout_message, cash_incentive_message, credit_incentive_message, terms_text, require_terms_acceptance, drop_in_enabled, drop_in_message, delivery_enabled, delivery_message, address_acknowledgment_message",
      )
      .eq("store_id", store.id)
      .maybeSingle();
    if (data) {
      checkoutConfig = {
        checkoutMessage: data.checkout_message,
        cashIncentiveMessage: data.cash_incentive_message,
        creditIncentiveMessage: data.credit_incentive_message,
        termsText: data.terms_text,
        requireTermsAcceptance: data.require_terms_acceptance,
        dropInEnabled: data.drop_in_enabled,
        dropInMessage: data.drop_in_message,
        deliveryEnabled: data.delivery_enabled,
        deliveryMessage: data.delivery_message,
        addressAcknowledgmentMessage: data.address_acknowledgment_message,
      };
    }
  }

  return (
    <main>
      <PortalForm storeSlug={storeSlug} games={games} checkoutConfig={checkoutConfig} />
    </main>
  );
}
