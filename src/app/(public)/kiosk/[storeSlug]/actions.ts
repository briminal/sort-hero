"use server";

import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase/service";
import { verifyKioskPinCore } from "@/lib/kiosk/pin";
import { browseKioskInventoryCore, kioskAvailableFiltersCore, type KioskFilterOptions, type KioskInventoryRow } from "@/lib/kiosk/inventory";
import { kioskCookieName, KIOSK_SESSION_MAX_AGE_SECONDS, verifyKioskSession } from "@/lib/kiosk/session";
import { browseKioskInventorySchema, kioskAvailableFiltersSchema, submitKioskReservationSchema, verifyKioskPinSchema } from "@/types/kiosk";

type ActionResult<T> = T | { error: string };

// Same convention as buylist-portal's actions.ts -- this file is reachable
// by anonymous internet visitors, so only errors deliberately raised as
// user-safe (PublicError) are shown verbatim; anything else is logged
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

export async function verifyKioskPin(
  input: { storeSlug: string; pin: string },
): Promise<ActionResult<{ ok: true } | { ok: false; lockedUntil: string | null; attemptsRemaining: number }>> {
  const parsed = verifyKioskPinSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const storeId = await resolveStoreId(parsed.data.storeSlug);
    const result = await verifyKioskPinCore(storeId, parsed.data.pin);

    if (!result.ok) {
      return { ok: false, lockedUntil: result.lockedUntil, attemptsRemaining: result.attemptsRemaining };
    }

    const cookieStore = await cookies();
    cookieStore.set(kioskCookieName(), result.sessionToken!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/kiosk/${parsed.data.storeSlug}`,
      maxAge: KIOSK_SESSION_MAX_AGE_SECONDS,
    });

    return { ok: true };
  } catch (err) {
    return logAndFallback(err, "Could not verify PIN");
  }
}

export async function searchKioskInventory(input: {
  storeSlug: string;
  gameCode?: string;
  query?: string;
  setId?: string;
  rarity?: string;
  sort?: "name_asc" | "price_asc" | "price_desc";
  limit?: number;
  offset?: number;
}): Promise<ActionResult<KioskInventoryRow[]>> {
  const parsed = browseKioskInventorySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const storeId = await resolveStoreId(parsed.data.storeSlug);

    const cookieStore = await cookies();
    const token = cookieStore.get(kioskCookieName())?.value;
    if (!verifyKioskSession(token, storeId)) throw new PublicError("Session expired");

    return await browseKioskInventoryCore({
      storeId,
      gameCode: parsed.data.gameCode,
      query: parsed.data.query,
      setId: parsed.data.setId,
      rarity: parsed.data.rarity,
      sort: parsed.data.sort,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  } catch (err) {
    return logAndFallback(err, "Could not load inventory");
  }
}

export async function submitKioskReservation(input: {
  storeSlug: string;
  customerNameOrPhone: string;
  items: { inventoryItemId: string; quantity: number }[];
}): Promise<ActionResult<{ reservationId: string }>> {
  const parsed = submitKioskReservationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const storeId = await resolveStoreId(parsed.data.storeSlug);

    const cookieStore = await cookies();
    const token = cookieStore.get(kioskCookieName())?.value;
    if (!verifyKioskSession(token, storeId)) throw new PublicError("Session expired");

    const supabase = getServiceClient();
    // The RPC re-validates every line's live stock/price itself -- this
    // action never trusts the client cart's held quantities/prices, same
    // rule as every other checkout path in this app.
    const { data, error } = await supabase.rpc("submit_kiosk_reservation", {
      p_store_id: storeId,
      p_customer_name_or_phone: parsed.data.customerNameOrPhone,
      p_items: parsed.data.items.map((i) => ({ inventoryItemId: i.inventoryItemId, quantity: i.quantity })),
    });
    if (error) throw new PublicError(error.message.includes("No items") ? "Those items are no longer available." : "Could not submit your order");

    return { reservationId: data as string };
  } catch (err) {
    return logAndFallback(err, "Could not submit your order");
  }
}

export async function getKioskFilters(input: { storeSlug: string; gameCode?: string }): Promise<ActionResult<KioskFilterOptions>> {
  const parsed = kioskAvailableFiltersSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const storeId = await resolveStoreId(parsed.data.storeSlug);

    const cookieStore = await cookies();
    const token = cookieStore.get(kioskCookieName())?.value;
    if (!verifyKioskSession(token, storeId)) throw new PublicError("Session expired");

    return await kioskAvailableFiltersCore(storeId, parsed.data.gameCode);
  } catch (err) {
    return logAndFallback(err, "Could not load filters");
  }
}
