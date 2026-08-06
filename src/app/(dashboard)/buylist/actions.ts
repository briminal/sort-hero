"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import {
  completeSubmissionSchema,
  declineSubmissionSchema,
  postStaffMessageSchema,
  priceSubmissionSchema,
  saveBuylistCheckoutConfigSchema,
  saveBuylistRulesSchema,
  sendBuylistItemToInventorySchema,
  verifyBuylistItemSchema,
} from "@/types/buylist";
import { saveBuylistPriceSourceConfigSchema, type BuylistPricingRule } from "@/types/buylist-pricing";

type ActionResult<T> = T | { error: string };

export async function saveBuylistPricingRules(input: {
  gameId: string | null;
  setId: string | null;
  rules: BuylistPricingRule[];
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = saveBuylistRulesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    // Scoped delete+insert on just this (game, set) -- rules for every
    // other scope are never read or rewritten, so two staff saving
    // different scopes concurrently can't race and clobber each other.
    const { error } = await supabase.rpc("replace_buylist_pricing_rules_for_scope", {
      p_store_id: storeId,
      p_game_id: parsed.data.gameId,
      p_set_id: parsed.data.setId,
      p_rules: parsed.data.rules,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/buylist/pricing");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save rules" };
  }
}

export async function getSetsForGame(gameId: string): Promise<ActionResult<{ id: string; name: string }[]>> {
  const supabase = await createClient();

  try {
    await getMyStore(supabase);
    const { data, error } = await supabase.from("sets").select("id, name").eq("game_id", gameId).order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load sets" };
  }
}

export async function saveBuylistPriceSourceConfig(
  input: Parameters<typeof saveBuylistPriceSourceConfigSchema.parse>[0],
): Promise<ActionResult<{ ok: true }>> {
  const parsed = saveBuylistPriceSourceConfigSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    const { error } = await supabase.rpc("replace_buylist_price_source_config", {
      p_store_id: storeId,
      p_game_id: parsed.data.gameId,
      p_config: parsed.data,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/buylist/pricing");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save price source config" };
  }
}

export async function priceSubmission(input: {
  submissionId: string;
  items: { itemId: string; quantityApproved: number; offeredCashPriceCents: number; offeredCreditPriceCents: number }[];
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = priceSubmissionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { error } = await supabase.rpc("price_buylist_submission", {
      p_submission_id: parsed.data.submissionId,
      p_items: parsed.data.items,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/buylist/${parsed.data.submissionId}`);
    revalidatePath("/buylist");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not price submission" };
  }
}

export async function completeSubmission(input: {
  submissionId: string;
  payoutMethod: "cash" | "store_credit";
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = completeSubmissionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { error } = await supabase.rpc("approve_buylist_submission", {
      p_submission_id: parsed.data.submissionId,
      p_payout_method: parsed.data.payoutMethod,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/buylist/${parsed.data.submissionId}`);
    revalidatePath("/buylist");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not complete submission" };
  }
}

export async function declineSubmission(input: { submissionId: string }): Promise<ActionResult<{ ok: true }>> {
  const parsed = declineSubmissionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    // Only pending/priced submissions can be declined -- without this
    // guard, a submission already paid out (completed, with inventory and
    // possibly store credit already granted) could be silently flipped to
    // "declined", leaving the audit trail inconsistent with what actually
    // happened financially.
    const { data, error } = await supabase
      .from("buylist_submissions")
      .update({ status: "declined" })
      .eq("id", parsed.data.submissionId)
      .in("status", ["pending", "priced"])
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error("Submission can't be declined (already accepted, completed, or declined)");
    }

    revalidatePath(`/buylist/${parsed.data.submissionId}`);
    revalidatePath("/buylist");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not decline submission" };
  }
}

export async function postStaffMessage(input: { submissionId: string; body: string }): Promise<ActionResult<{ ok: true }>> {
  const parsed = postStaffMessageSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { error } = await supabase
      .from("buylist_messages")
      .insert({ submission_id: parsed.data.submissionId, sender: "staff", body: parsed.data.body });
    if (error) throw new Error(error.message);

    revalidatePath(`/buylist/${parsed.data.submissionId}`);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send message" };
  }
}

export async function verifyBuylistItem(input: {
  submissionId: string;
  itemId: string;
  verifiedQuantity: number;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = verifyBuylistItemSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { error } = await supabase.rpc("verify_buylist_item", {
      p_item_id: parsed.data.itemId,
      p_verified_quantity: parsed.data.verifiedQuantity,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/buylist/${parsed.data.submissionId}`);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not verify item" };
  }
}

export async function sendBuylistItemToInventory(input: {
  submissionId: string;
  itemId: string;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = sendBuylistItemToInventorySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { error } = await supabase.rpc("send_buylist_item_to_inventory", { p_item_id: parsed.data.itemId });
    if (error) throw new Error(error.message);

    revalidatePath(`/buylist/${parsed.data.submissionId}`);
    revalidatePath("/inventory");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send item to inventory" };
  }
}

export async function saveBuylistCheckoutConfig(input: {
  checkoutMessage: string | null;
  cashIncentiveMessage: string | null;
  creditIncentiveMessage: string | null;
  termsText: string | null;
  requireTermsAcceptance: boolean;
  dropInEnabled: boolean;
  dropInMessage: string | null;
  deliveryEnabled: boolean;
  deliveryMessage: string | null;
  addressAcknowledgmentMessage: string | null;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = saveBuylistCheckoutConfigSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    const { error } = await supabase.rpc("upsert_buylist_checkout_config", {
      p_store_id: storeId,
      p_checkout_message: parsed.data.checkoutMessage,
      p_cash_incentive_message: parsed.data.cashIncentiveMessage,
      p_credit_incentive_message: parsed.data.creditIncentiveMessage,
      p_terms_text: parsed.data.termsText,
      p_require_terms_acceptance: parsed.data.requireTermsAcceptance,
      p_drop_in_enabled: parsed.data.dropInEnabled,
      p_drop_in_message: parsed.data.dropInMessage,
      p_delivery_enabled: parsed.data.deliveryEnabled,
      p_delivery_message: parsed.data.deliveryMessage,
      p_address_acknowledgment_message: parsed.data.addressAcknowledgmentMessage,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/buylist/checkout-message");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save checkout messaging" };
  }
}
