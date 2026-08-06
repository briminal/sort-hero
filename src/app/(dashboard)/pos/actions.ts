"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { getStripe } from "@/lib/stripe/client";
import {
  closeTillSchema,
  completeCashPaymentSchema,
  confirmCardPaymentSchema,
  createOrderSchema,
  createPaymentIntentSchema,
  openTillSchema,
  processReturnSchema,
} from "@/types/pos";
import { computeBuylistOffer, type BuylistOffer } from "@/lib/pricing/buylist-offer";
import { completeStoreCreditPaymentSchema, createPosBuySchema, previewBuylistOfferSchema } from "@/types/buylist";

type ActionResult<T> = T | { error: string };

/** Completes the order once every payment for it has succeeded -- called
 * after both cash and card payment paths, so split payments (some cash,
 * some card) only finalize once the running total actually covers it. */
async function maybeCompleteOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<void> {
  const { data: order } = await supabase
    .from("orders")
    .select("total_cents, status")
    .eq("id", orderId)
    .single();
  if (!order || order.status !== "pending") return;

  const { data: payments } = await supabase
    .from("payments")
    .select("amount_cents")
    .eq("order_id", orderId)
    .eq("status", "succeeded");

  const paid = (payments ?? []).reduce((sum, p) => sum + (p.amount_cents as number), 0);
  if (paid >= order.total_cents) {
    const { error } = await supabase.rpc("complete_order", { p_order_id: orderId });
    if (error) throw new Error(error.message);
  }
}

/** How much of the order is still unpaid -- every payment action must clamp
 * a client-submitted amount against this before charging/recording it.
 * Without this, a client could submit any amountCents (a real Stripe
 * charge, a cash ledger entry, or a store-credit debit) with nothing on the
 * server checking it against what the order actually costs. */
async function getOrderRemainingCents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<number> {
  const { data: order, error } = await supabase
    .from("orders")
    .select("total_cents, status")
    .eq("id", orderId)
    .single();
  if (error || !order) throw new Error("Order not found");
  if (order.status !== "pending") throw new Error(`Order is not pending (status: ${order.status})`);

  const { data: payments } = await supabase
    .from("payments")
    .select("amount_cents")
    .eq("order_id", orderId)
    .eq("status", "succeeded");

  const paid = (payments ?? []).reduce((sum, p) => sum + (p.amount_cents as number), 0);
  return order.total_cents - paid;
}

export type SaleSearchResult = {
  id: string;
  cardId: string;
  cardName: string;
  setName: string | null;
  imageUrl: string | null;
  condition: string;
  printing: string;
  priceCents: number | null;
  quantity: number;
};

export type ReservationForPos = { id: string; cardName: string; unitPriceCents: number; quantity: number; maxQuantity: number };

export type PendingReservation = { id: string; customerNameOrPhone: string; totalCents: number; createdAt: string };

/** Backs the POS "Reserved" tab -- staff should see kiosk checkouts appear
 * automatically rather than having to go find them elsewhere first. */
export async function listPendingKioskReservations(): Promise<ActionResult<PendingReservation[]>> {
  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    const { data, error } = await supabase
      .from("kiosk_reservations")
      .select("id, customer_name_or_phone, total_cents, created_at")
      .eq("store_id", storeId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      customerNameOrPhone: row.customer_name_or_phone as string,
      totalCents: row.total_cents as number,
      createdAt: row.created_at as string,
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load reservations" };
  }
}

/** Pulls a kiosk reservation's lines into POS cart-ready shape -- RLS
 * (is_store_member) on kiosk_reservations/inventory_items is what actually
 * enforces store-scoping; a reservation id from another store simply
 * resolves to zero rows. Current live stock (not the snapshotted quantity)
 * caps quantity, since stock may have moved since the customer checked out. */
export async function getKioskReservationForPos(reservationId: string): Promise<ActionResult<ReservationForPos[]>> {
  const supabase = await createClient();

  try {
    const { data, error } = await supabase
      .from("kiosk_reservation_items")
      .select("inventory_item_id, card_name, unit_price_cents, quantity, inventory_items(quantity)")
      .eq("reservation_id", reservationId);
    if (error) throw new Error(error.message);

    return (data ?? [])
      .filter((row) => row.inventory_item_id !== null)
      .map((row) => ({
        id: row.inventory_item_id as string,
        cardName: row.card_name as string,
        unitPriceCents: row.unit_price_cents as number,
        quantity: row.quantity as number,
        maxQuantity: (row.inventory_items as unknown as { quantity: number } | null)?.quantity ?? 0,
      }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load reservation" };
  }
}

/** Interactive search-as-you-type for the POS cart -- needs a callable
 * action rather than the URL-searchParams pattern used by the Inventory
 * list page, since this drives live typeahead, not a page navigation. */
export async function searchInventoryForSale(query: string): Promise<ActionResult<SaleSearchResult[]>> {
  if (query.trim().length < 2) return [];

  const supabase = await createClient();

  try {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id, price_cents, quantity, condition, printing, card_id, cards!inner(name, image_url, sets(name))")
      // Staged items aren't real available stock yet -- only confirmed
      // inventory should ever be sellable at the register.
      .eq("status", "confirmed")
      .gt("quantity", 0)
      .ilike("cards.name", `%${query}%`)
      .limit(40);
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      cardId: row.card_id as string,
      cardName: (row.cards as unknown as { name: string; image_url: string | null; sets: { name: string } | null }).name,
      setName: (row.cards as unknown as { name: string; image_url: string | null; sets: { name: string } | null }).sets?.name ?? null,
      imageUrl: (row.cards as unknown as { name: string; image_url: string | null; sets: { name: string } | null }).image_url,
      condition: row.condition as string,
      printing: row.printing as string,
      priceCents: row.price_cents as number | null,
      quantity: row.quantity as number,
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Search failed" };
  }
}

export async function createConnectionToken(): Promise<ActionResult<{ secret: string }>> {
  try {
    const stripe = getStripe();
    const token = await stripe.terminal.connectionTokens.create();
    return { secret: token.secret };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create connection token" };
  }
}

export async function createOrder(input: {
  tillId: string;
  items?: { inventoryItemId: string; quantity: number; taxable?: boolean; deductInventory?: boolean }[];
  customItems?: { name: string; unitPriceCents: number; quantity: number; taxable?: boolean }[];
  discountCents?: number;
  taxExempt?: boolean;
}): Promise<ActionResult<{ orderId: string; totalCents: number; taxCents: number; discountCents: number }>> {
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("tax_rate_percent, round_to_nearest_cents")
      .eq("id", storeId)
      .single();
    if (storeError || !store) throw new Error(storeError?.message ?? "Store not found");

    const ids = parsed.data.items.map((i) => i.inventoryItemId);
    const { data: rows, error: fetchError } =
      ids.length > 0
        ? await supabase
            .from("inventory_items")
            .select("id, price_cents, cost_cents, quantity, card_id, cards!inner(name)")
            .in("id", ids)
        : { data: [], error: null };
    if (fetchError) throw new Error(fetchError.message);

    // Server always recomputes totals from live DB state -- client-submitted
    // prices/quantities are never trusted, per the security architecture.
    const lineItems: {
      inventory_item_id: string | null;
      card_id: string | null;
      card_name: string;
      quantity: number;
      unit_price_cents: number;
      line_total_cents: number;
      unit_cost_cents: number | null;
      taxable: boolean;
      deduct_inventory: boolean;
    }[] = [];

    for (const cartItem of parsed.data.items) {
      const row = rows?.find((r) => r.id === cartItem.inventoryItemId);
      if (!row) return { error: `Inventory item not found: ${cartItem.inventoryItemId}` };
      if (row.price_cents === null) return { error: `${(row.cards as unknown as { name: string }).name} has no price set` };
      if (cartItem.deductInventory !== false && cartItem.quantity > row.quantity) {
        return { error: `Not enough stock for ${(row.cards as unknown as { name: string }).name}` };
      }

      lineItems.push({
        inventory_item_id: row.id,
        card_id: row.card_id,
        card_name: (row.cards as unknown as { name: string }).name,
        quantity: cartItem.quantity,
        unit_price_cents: row.price_cents,
        line_total_cents: row.price_cents * cartItem.quantity,
        unit_cost_cents: row.cost_cents,
        taxable: cartItem.taxable,
        deduct_inventory: cartItem.deductInventory !== false,
      });
    }

    // Custom items have no card/inventory row at all -- e.g. a supply fee or
    // a one-off item not tracked in inventory. Price comes straight from the
    // cashier's input since there's no DB row to recompute it from; this is
    // the one deliberate exception to "never trust a client-submitted price."
    for (const customItem of parsed.data.customItems) {
      lineItems.push({
        inventory_item_id: null,
        card_id: null,
        card_name: customItem.name,
        quantity: customItem.quantity,
        unit_price_cents: customItem.unitPriceCents,
        line_total_cents: customItem.unitPriceCents * customItem.quantity,
        unit_cost_cents: null,
        taxable: customItem.taxable,
        deduct_inventory: false,
      });
    }

    const subtotalCents = lineItems.reduce((sum, li) => sum + li.line_total_cents, 0);
    if (subtotalCents <= 0) return { error: "Cart total must be greater than zero" };

    const discountCents = Math.min(parsed.data.discountCents, subtotalCents);

    // Tax is computed on taxable lines only, before the cart discount is
    // subtracted -- a simpler (and defensible) rule than proportionally
    // allocating the discount across taxable/non-taxable lines.
    const taxableSubtotalCents = lineItems.filter((li) => li.taxable).reduce((sum, li) => sum + li.line_total_cents, 0);
    const taxCents = parsed.data.taxExempt
      ? 0
      : Math.round(taxableSubtotalCents * (Number(store.tax_rate_percent) / 100));

    let totalCents = subtotalCents - discountCents + taxCents;
    if (store.round_to_nearest_cents) {
      totalCents = Math.round(totalCents / store.round_to_nearest_cents) * store.round_to_nearest_cents;
    }
    if (totalCents <= 0) return { error: "Cart total must be greater than zero" };

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        store_id: storeId,
        till_id: parsed.data.tillId,
        status: "pending",
        subtotal_cents: subtotalCents,
        discount_cents: discountCents,
        tax_cents: taxCents,
        tax_exempt: parsed.data.taxExempt,
        total_cents: totalCents,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(orderError?.message ?? "Could not create order");

    const { error: itemsError } = await supabase.from("order_items").insert(
      lineItems.map((li) => ({ order_id: order.id, ...li })),
    );
    if (itemsError) throw new Error(itemsError.message);

    return { orderId: order.id as string, totalCents, taxCents, discountCents };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create order" };
  }
}

export async function createPaymentIntent(input: {
  orderId: string;
  amountCents: number;
}): Promise<ActionResult<{ clientSecret: string; paymentIntentId: string }>> {
  const parsed = createPaymentIntentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const remainingCents = await getOrderRemainingCents(supabase, parsed.data.orderId);
    if (parsed.data.amountCents > remainingCents) {
      return { error: `Amount exceeds the order's remaining balance ($${(remainingCents / 100).toFixed(2)})` };
    }

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.create({
      amount: parsed.data.amountCents,
      currency: "cad",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      metadata: { order_id: parsed.data.orderId },
    });
    if (!intent.client_secret) throw new Error("Stripe did not return a client secret");

    return { clientSecret: intent.client_secret, paymentIntentId: intent.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create payment intent" };
  }
}

export async function confirmCardPayment(input: {
  orderId: string;
  paymentIntentId: string;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = confirmCardPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const stripe = getStripe();

  try {
    // Re-fetches from Stripe server-side -- the client's reported "success"
    // is never trusted directly.
    const intent = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
    if (intent.status !== "succeeded") {
      return { error: `Payment not succeeded (status: ${intent.status})` };
    }

    // record_pos_payment locks the order and rechecks the remaining balance
    // itself (see the payment-integrity bugfix migration) -- the card has
    // already been charged by this point, so if the order turns out to
    // already be covered (a concurrent payment beat this one, or a retried
    // request already recorded it), the just-created charge is refunded
    // immediately rather than left as a silent overcharge with no matching
    // payments row.
    const { error: paymentError } = await supabase.rpc("record_pos_payment", {
      p_order_id: parsed.data.orderId,
      p_method: "card",
      p_amount_cents: intent.amount_received,
      p_stripe_payment_intent_id: intent.id,
    });
    if (paymentError) {
      await stripe.refunds.create({ payment_intent: intent.id });
      throw new Error(`${paymentError.message} -- the card charge was refunded automatically.`);
    }

    await maybeCompleteOrder(supabase, parsed.data.orderId);

    revalidatePath("/pos");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not confirm payment" };
  }
}

export async function completeCashPayment(input: {
  orderId: string;
  amountCents: number;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = completeCashPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    // Cash needs no external verification -- the cashier is physically
    // counting it, standard POS practice, unlike card which needs Stripe's
    // word before we trust it. record_pos_payment locks the order for the
    // whole check+insert, so two concurrent cash-payment requests for the
    // same order can't both slip past the remaining-balance check.
    const { error: paymentError } = await supabase.rpc("record_pos_payment", {
      p_order_id: parsed.data.orderId,
      p_method: "cash",
      p_amount_cents: parsed.data.amountCents,
    });
    if (paymentError) throw new Error(paymentError.message);

    await maybeCompleteOrder(supabase, parsed.data.orderId);

    revalidatePath("/pos");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not complete cash payment" };
  }
}

export async function openTill(input: {
  name: string;
  openingCashCents: number;
}): Promise<ActionResult<{ tillId: string }>> {
  const parsed = openTillSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("tills")
      .insert({
        store_id: storeId,
        name: parsed.data.name,
        status: "open",
        opened_by: user?.id ?? null,
        opened_at: new Date().toISOString(),
        opening_cash_cents: parsed.data.openingCashCents,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not open till");

    revalidatePath("/pos/tills");
    return { tillId: data.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not open till" };
  }
}

export async function closeTill(input: {
  tillId: string;
  closingCashCents: number;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = closeTillSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { error } = await supabase
      .from("tills")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closing_cash_cents: parsed.data.closingCashCents,
      })
      .eq("id", parsed.data.tillId);
    if (error) throw new Error(error.message);

    revalidatePath("/pos/tills");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not close till" };
  }
}

export async function processReturn(input: {
  orderId: string;
  items: { inventoryItemId: string; quantity: number }[];
  reason?: string | null;
}): Promise<ActionResult<{ refundId: string; refundAmountCents: number }>> {
  const parsed = processReturnSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { data: orderItems, error: itemsError } = await supabase
      .from("order_items")
      .select("inventory_item_id, unit_price_cents, quantity")
      .eq("order_id", parsed.data.orderId);
    if (itemsError) throw new Error(itemsError.message);

    // Refund amount is always computed from the order's own recorded unit
    // prices, never a client-submitted amount -- and capped at what was
    // actually purchased, so a return can't claim more than was sold.
    const cappedItems: { inventoryItemId: string; quantity: number }[] = [];
    let refundAmountCents = 0;

    for (const reqItem of parsed.data.items) {
      const orderItem = orderItems?.find((oi) => oi.inventory_item_id === reqItem.inventoryItemId);
      if (!orderItem) continue;
      const qty = Math.min(reqItem.quantity, orderItem.quantity);
      if (qty <= 0) continue;
      cappedItems.push({ inventoryItemId: reqItem.inventoryItemId, quantity: qty });
      refundAmountCents += orderItem.unit_price_cents * qty;
    }

    if (refundAmountCents <= 0 || cappedItems.length === 0) {
      return { error: "Nothing eligible to refund for this order" };
    }

    // Reserves (and clamps against what's already been refunded) BEFORE any
    // external Stripe call, so two return requests for the same item(s)
    // can't each independently pass and each issue a real Stripe refund --
    // Stripe only rejects a refund exceeding the *original charge total*,
    // not a second valid partial refund. Mirrors the claim-before-spend
    // pattern already used for Shippo label purchases.
    const { data: reservation, error: reserveError } = await supabase
      .rpc("reserve_return", {
        p_order_id: parsed.data.orderId,
        p_requested_amount_cents: refundAmountCents,
        p_reason: parsed.data.reason ?? null,
      })
      .single();
    if (reserveError) throw new Error(reserveError.message);

    const { refund_id: refundId, actual_amount_cents: actualRefundCents } = reservation as unknown as {
      refund_id: string;
      actual_amount_cents: number;
    };

    try {
      const { data: cardPayment } = await supabase
        .from("payments")
        .select("stripe_payment_intent_id")
        .eq("order_id", parsed.data.orderId)
        .eq("method", "card")
        .eq("status", "succeeded")
        .limit(1)
        .maybeSingle();

      let stripeRefundId: string | null = null;
      if (cardPayment?.stripe_payment_intent_id) {
        const stripe = getStripe();
        const refund = await stripe.refunds.create({
          payment_intent: cardPayment.stripe_payment_intent_id,
          amount: actualRefundCents,
        });
        stripeRefundId = refund.id;
      } else {
        // No card payment to refund via Stripe -- check whether this order
        // was (partly) paid with store credit, which otherwise would just
        // silently vanish on a return: inventory gets restocked and a
        // `refunds` row recorded, but the customer's balance never came back.
        const { data: creditPayment } = await supabase
          .from("payments")
          .select("customer_id, amount_cents")
          .eq("order_id", parsed.data.orderId)
          .eq("method", "store_credit")
          .eq("status", "succeeded")
          .limit(1)
          .maybeSingle();

        if (creditPayment?.customer_id) {
          // Capped at what was actually paid via store credit -- if the order
          // was also partly cash, that portion isn't auto-refunded here, same
          // as cash-only orders today (handled physically by staff).
          const creditRefundCents = Math.min(actualRefundCents, creditPayment.amount_cents);
          const { error: creditRefundError } = await supabase.rpc("refund_store_credit", {
            p_customer_id: creditPayment.customer_id,
            p_amount_cents: creditRefundCents,
            p_order_id: parsed.data.orderId,
            p_reason: "POS return",
          });
          if (creditRefundError) throw new Error(creditRefundError.message);
        }
      }

      const { error: finalizeError } = await supabase.rpc("finalize_return", {
        p_refund_id: refundId,
        p_items: cappedItems.map((i) => ({ inventoryItemId: i.inventoryItemId, quantity: i.quantity })),
        p_stripe_refund_id: stripeRefundId,
      });
      if (finalizeError) throw new Error(finalizeError.message);
    } catch (err) {
      // The reservation never got finalized (Stripe/store-credit call or
      // finalize_return itself failed) -- free it back up so a legitimate
      // retry isn't clamped against a refund that never actually happened.
      await supabase.rpc("cancel_return_reservation", { p_refund_id: refundId });
      throw err;
    }

    revalidatePath("/pos/returns");
    return {
      refundId,
      refundAmountCents: actualRefundCents,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not process return" };
  }
}

export async function previewBuylistOffer(input: {
  items: { cardId: string; cardName: string; condition: string; quantity: number }[];
}): Promise<ActionResult<BuylistOffer>> {
  const parsed = previewBuylistOfferSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    return await computeBuylistOffer(supabase, storeId, parsed.data.items);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not compute offer" };
  }
}

export async function createPosBuy(input: {
  customer: { name?: string; email?: string; phone?: string };
  items: { cardId: string; cardName: string; condition: string; quantity: number }[];
  payoutMethod: "cash" | "store_credit";
}): Promise<ActionResult<{ submissionId: string }>> {
  const parsed = createPosBuySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    // Offer is recomputed server-side from live market prices + buy pricing
    // rules -- never trusts a client-submitted price -- same as every other
    // money-affecting POS action.
    const offer = await computeBuylistOffer(supabase, storeId, parsed.data.items);

    const { data: submissionId, error } = await supabase.rpc("create_pos_buy", {
      p_store_id: storeId,
      p_customer: parsed.data.customer,
      p_items: offer.lines.map((line) => ({
        cardId: line.cardId,
        cardName: line.cardName,
        condition: line.condition,
        quantity: line.quantity,
        cashPriceCents: line.cashUnitPriceCents,
        creditPriceCents: line.creditUnitPriceCents,
      })),
      p_payout_method: parsed.data.payoutMethod,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/pos/buy");
    return { submissionId: submissionId as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not complete buy" };
  }
}

export async function completeStoreCreditPayment(input: {
  orderId: string;
  customerId: string;
  amountCents: number;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = completeStoreCreditPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const remainingCents = await getOrderRemainingCents(supabase, parsed.data.orderId);
    if (parsed.data.amountCents > remainingCents) {
      return { error: `Amount exceeds the order's remaining balance ($${(remainingCents / 100).toFixed(2)})` };
    }

    // Balance check, decrement, audit log, and the payments row all happen
    // atomically inside redeem_store_credit -- see the migration.
    const { error } = await supabase.rpc("redeem_store_credit", {
      p_order_id: parsed.data.orderId,
      p_customer_id: parsed.data.customerId,
      p_amount_cents: parsed.data.amountCents,
    });
    if (error) throw new Error(error.message);

    await maybeCompleteOrder(supabase, parsed.data.orderId);

    revalidatePath("/pos");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not redeem store credit" };
  }
}

export type BuylistCustomerSearchResult = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  storeCreditBalanceCents: number;
};

export async function searchBuylistCustomers(query: string): Promise<ActionResult<BuylistCustomerSearchResult[]>> {
  if (query.trim().length < 2) return [];

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    const { data, error } = await supabase
      .from("buylist_customers")
      .select("id, name, email, phone, store_credit_balance_cents")
      .eq("store_id", storeId)
      .or(`name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
      .limit(20);
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string | null,
      email: row.email as string | null,
      phone: row.phone as string | null,
      storeCreditBalanceCents: row.store_credit_balance_cents as number,
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Search failed" };
  }
}
