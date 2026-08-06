"use server";

import { getServiceClient } from "@/lib/supabase/service";
import { computeBuylistOffer, type BuylistOffer } from "@/lib/pricing/buylist-offer";
import {
  browseCardsSchema,
  postCustomerMessageSchema,
  previewOfferSchema,
  respondToOfferSchema,
  submissionTokenSchema,
  submitBuylistSchema,
} from "@/types/buylist";

type ActionResult<T> = T | { error: string };

// Raw Postgres/Supabase error messages can leak column/constraint names --
// fine for staff-only dashboard actions, but this file is reachable by
// anonymous internet visitors, so only errors we deliberately raise as
// user-safe (PublicError) are ever shown verbatim; anything else is logged
// server-side and replaced with a generic message.
class PublicError extends Error {}

function logAndFallback(err: unknown, fallback: string): { error: string } {
  if (err instanceof PublicError) return { error: err.message };
  console.error(err);
  return { error: fallback };
}

async function resolveStoreId(storeSlug: string): Promise<string> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("stores").select("id").eq("slug", storeSlug).single();
  if (error || !data) throw new PublicError("Store not found");
  return data.id as string;
}

export type CardSearchResult = {
  id: string;
  name: string;
  setName: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;
};

/** Public card search for the portal's cart builder -- same trigram RPC as
 * Scanning/POS buy mode, called via the service-role client since anon has
 * no grant on search_cards (only authenticated/service_role do). */
export async function searchCards(input: {
  gameCode: string;
  query: string;
}): Promise<ActionResult<CardSearchResult[]>> {
  if (input.query.trim().length < 2) return [];

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("search_cards", {
      p_game_code: input.gameCode,
      p_query: input.query,
      p_limit: 20,
    });
    if (error) throw new Error(error.message);

    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      setName: (row.set_name as string | null) ?? null,
      collectorNumber: (row.collector_number as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
    }));
  } catch (err) {
    return logAndFallback(err, "Search failed");
  }
}

export type BrowseCard = {
  id: string;
  name: string;
  setName: string | null;
  rarity: string | null;
  imageUrl: string | null;
};

export type BrowseCardsResult = { cards: BrowseCard[]; totalCount: number } | { error: string };

const BROWSE_PAGE_SIZE = 24;

/** Paginated card browsing for the portal's grid (as opposed to searchCards'
 * type-ahead) -- lets a customer scroll a whole game/set instead of only
 * finding cards they already know the exact name of. */
export async function browseCards(input: {
  gameCode: string;
  setId?: string | null;
  query?: string;
  page?: number;
}): Promise<BrowseCardsResult> {
  const parsed = browseCardsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const supabase = getServiceClient();
    const { data: game, error: gameError } = await supabase.from("games").select("id").eq("code", parsed.data.gameCode).maybeSingle();
    if (gameError) throw new Error(gameError.message);
    if (!game) return { cards: [], totalCount: 0 };

    let query = supabase
      .from("cards")
      .select("id, name, rarity, image_url, sets(name)", { count: "exact" })
      .eq("game_id", game.id);
    if (parsed.data.setId) query = query.eq("set_id", parsed.data.setId);
    if (parsed.data.query && parsed.data.query.trim().length > 0) query = query.ilike("name", `%${parsed.data.query.trim()}%`);

    const from = (parsed.data.page - 1) * BROWSE_PAGE_SIZE;
    const { data, error, count } = await query.order("name").range(from, from + BROWSE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    return {
      cards: (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        setName: (row.sets as unknown as { name: string } | null)?.name ?? null,
        rarity: row.rarity as string | null,
        imageUrl: row.image_url as string | null,
      })),
      totalCount: count ?? 0,
    };
  } catch (err) {
    return logAndFallback(err, "Could not load cards");
  }
}

export type SetOption = { id: string; name: string };

/** Set filter options for the browse grid -- public equivalent of the
 * dashboard's getSetsForGame (that one requires an authenticated store
 * member; this is called from the anonymous portal). */
export async function getSetsForGamePublic(gameCode: string): Promise<ActionResult<SetOption[]>> {
  try {
    const supabase = getServiceClient();
    const { data: game, error: gameError } = await supabase.from("games").select("id").eq("code", gameCode).maybeSingle();
    if (gameError) throw new Error(gameError.message);
    if (!game) return [];

    const { data, error } = await supabase.from("sets").select("id, name").eq("game_id", game.id).order("name");
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
  } catch (err) {
    return logAndFallback(err, "Could not load sets");
  }
}

export async function previewOffer(input: {
  storeSlug: string;
  items: { cardId: string; cardName: string; condition: string; quantity: number }[];
}): Promise<ActionResult<BuylistOffer>> {
  const parsed = previewOfferSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const storeId = await resolveStoreId(parsed.data.storeSlug);
    const supabase = getServiceClient();
    return await computeBuylistOffer(supabase, storeId, parsed.data.items);
  } catch (err) {
    return logAndFallback(err, "Could not compute offer");
  }
}

export async function submitBuylist(input: {
  storeSlug: string;
  customer: { name: string; email: string; phone?: string };
  items: {
    cardId: string;
    cardName: string;
    condition: string;
    quantity: number;
    payoutType?: "cash" | "credit";
    printing?: string;
    language?: string;
    notes?: string | null;
  }[];
  fulfillmentMethod?: "drop_in" | "delivery" | null;
  paymentAccount?: string | null;
  orderNotes?: string | null;
  acceptedTerms?: boolean;
  addressAcknowledged?: boolean;
}): Promise<ActionResult<{ accessToken: string }>> {
  const parsed = submitBuylistSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const storeId = await resolveStoreId(parsed.data.storeSlug);
    const supabase = getServiceClient();

    // Re-check the terms/address-ack gates server-side rather than trusting
    // the portal's disabled-until-checked button -- a client could
    // otherwise call this action directly and skip acceptance entirely.
    const { data: checkoutConfig } = await supabase
      .from("buylist_checkout_config")
      .select("require_terms_acceptance, address_acknowledgment_message, drop_in_enabled, delivery_enabled")
      .eq("store_id", storeId)
      .maybeSingle();
    if (checkoutConfig?.require_terms_acceptance && !parsed.data.acceptedTerms) {
      throw new PublicError("You must accept the terms before submitting");
    }
    if (checkoutConfig?.address_acknowledgment_message && !parsed.data.addressAcknowledged) {
      throw new PublicError("You must acknowledge the address message before submitting");
    }
    // The portal only shows a fulfillment method the store has enabled
    // (portal-form.tsx), but that's a client-side gate only -- re-check here
    // so a direct call can't attach a method the store explicitly disabled.
    if (parsed.data.fulfillmentMethod === "drop_in" && !checkoutConfig?.drop_in_enabled) {
      throw new PublicError("Drop-in is not available for this store");
    }
    if (parsed.data.fulfillmentMethod === "delivery" && !checkoutConfig?.delivery_enabled) {
      throw new PublicError("Delivery is not available for this store");
    }

    const offer = await computeBuylistOffer(supabase, storeId, parsed.data.items);

    let { data: customer } = await supabase
      .from("buylist_customers")
      .select("id")
      .eq("store_id", storeId)
      .eq("email", parsed.data.customer.email)
      .maybeSingle();

    if (!customer) {
      const { data: inserted, error: customerError } = await supabase
        .from("buylist_customers")
        .insert({
          store_id: storeId,
          name: parsed.data.customer.name,
          email: parsed.data.customer.email,
          phone: parsed.data.customer.phone ?? null,
        })
        .select("id")
        .single();
      if (customerError || !inserted) throw new Error(customerError?.message ?? "Could not create customer");
      customer = inserted;
    }

    const { data: submission, error: submissionError } = await supabase
      .from("buylist_submissions")
      .insert({
        store_id: storeId,
        customer_id: customer.id,
        channel: "portal",
        status: "pending",
        total_offer_cents: offer.totalCashCents,
        total_offer_credit_cents: offer.totalCreditCents,
        fulfillment_method: parsed.data.fulfillmentMethod ?? null,
        payment_account: parsed.data.paymentAccount ?? null,
        order_notes: parsed.data.orderNotes ?? null,
      })
      .select("id, access_token")
      .single();
    if (submissionError || !submission) throw new Error(submissionError?.message ?? "Could not create submission");

    const { error: itemsError } = await supabase.from("buylist_items").insert(
      offer.lines.map((line) => ({
        submission_id: submission.id,
        card_id: line.cardId,
        card_name: line.cardName,
        condition: line.condition,
        quantity_submitted: line.quantity,
        offered_unit_price_cents: line.cashUnitPriceCents,
        offered_credit_price_cents: line.creditUnitPriceCents,
        payout_type: line.payoutType ?? "cash",
        printing: line.printing ?? "normal",
        language: line.language ?? "EN",
        customer_notes: line.notes ?? null,
      })),
    );
    if (itemsError) throw new Error(itemsError.message);

    return { accessToken: submission.access_token as string };
  } catch (err) {
    return logAndFallback(err, "Could not submit buylist");
  }
}

export type SubmissionStatus = {
  status: string;
  totalOfferCents: number | null;
  totalOfferCreditCents: number | null;
  payoutMethod: string | null;
  createdAt: string;
  items: {
    cardName: string;
    condition: string;
    quantitySubmitted: number;
    quantityApproved: number | null;
    offeredUnitPriceCents: number;
    offeredCreditPriceCents: number | null;
  }[];
  messages: { sender: string; body: string; createdAt: string }[];
};

/** The customer's only "credential" -- an unguessable access_token, looked
 * up here via the service-role client. Never resolvable by id or email. */
export async function getSubmissionByToken(token: string): Promise<ActionResult<SubmissionStatus>> {
  const parsed = submissionTokenSchema.safeParse({ token });
  if (!parsed.success) return { error: "Invalid token" };

  try {
    const supabase = getServiceClient();
    const { data: submission, error } = await supabase
      .from("buylist_submissions")
      .select(
        "id, status, total_offer_cents, total_offer_credit_cents, payout_method, created_at, buylist_items(card_name, condition, quantity_submitted, quantity_approved, offered_unit_price_cents, offered_credit_price_cents), buylist_messages(sender, body, created_at)",
      )
      .eq("access_token", parsed.data.token)
      .single();
    if (error || !submission) throw new PublicError("Submission not found");

    return {
      status: submission.status as string,
      totalOfferCents: submission.total_offer_cents as number | null,
      totalOfferCreditCents: submission.total_offer_credit_cents as number | null,
      payoutMethod: submission.payout_method as string | null,
      createdAt: submission.created_at as string,
      items: (submission.buylist_items as unknown as SubmissionStatus["items"]) ?? [],
      messages: (submission.buylist_messages as unknown as SubmissionStatus["messages"]) ?? [],
    };
  } catch (err) {
    return logAndFallback(err, "Could not load submission");
  }
}

export async function postCustomerMessage(input: { token: string; body: string }): Promise<ActionResult<{ ok: true }>> {
  const parsed = postCustomerMessageSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const supabase = getServiceClient();
    const { data: submission, error: lookupError } = await supabase
      .from("buylist_submissions")
      .select("id")
      .eq("access_token", parsed.data.token)
      .single();
    if (lookupError || !submission) throw new PublicError("Submission not found");

    const { error } = await supabase
      .from("buylist_messages")
      .insert({ submission_id: submission.id, sender: "customer", body: parsed.data.body });
    if (error) throw new Error(error.message);

    return { ok: true };
  } catch (err) {
    return logAndFallback(err, "Could not send message");
  }
}

export async function respondToOffer(input: { token: string; accept: boolean }): Promise<ActionResult<{ ok: true }>> {
  const parsed = respondToOfferSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const supabase = getServiceClient();
    const { data: submission, error: lookupError } = await supabase
      .from("buylist_submissions")
      .select("id, status")
      .eq("access_token", parsed.data.token)
      .single();
    if (lookupError || !submission) throw new PublicError("Submission not found");
    if (submission.status !== "priced") {
      throw new PublicError(`This offer can't be responded to (status: ${submission.status})`);
    }

    const { error } = await supabase
      .from("buylist_submissions")
      .update({ status: parsed.data.accept ? "accepted" : "declined" })
      .eq("id", submission.id);
    if (error) throw new Error(error.message);

    return { ok: true };
  } catch (err) {
    return logAndFallback(err, "Could not respond to offer");
  }
}
