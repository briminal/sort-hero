"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getMyStore } from "@/lib/supabase/store";
import { completeKioskReservationSchema, setKioskPinSchema } from "@/types/kiosk";

type ActionResult<T> = T | { error: string };

async function requireOwner(): Promise<{ storeId: string }> {
  const supabase = await createClient();
  const { storeId, role } = await getMyStore(supabase);
  if (role !== "owner") {
    throw new Error("Only a store owner can manage the kiosk PIN");
  }
  return { storeId };
}

export async function updateKioskPin(input: { pin: string }): Promise<ActionResult<{ ok: true }>> {
  const parsed = setKioskPinSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const { storeId } = await requireOwner();
    const service = getServiceClient();

    const { error } = await service.rpc("set_kiosk_pin", { p_store_id: storeId, p_pin: parsed.data.pin });
    if (error) throw new Error(error.message);

    revalidatePath("/settings/kiosk");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update kiosk PIN" };
  }
}

export async function completeKioskReservation(input: { reservationId: string }): Promise<ActionResult<{ ok: true }>> {
  const parsed = completeKioskReservationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const supabase = await createClient();
    // RLS (is_store_member, checked again inside the RPC itself) is what
    // actually enforces store-scoping here -- an id belonging to another
    // store simply fails to resolve, matching the pattern used for every
    // other cross-store-guarded RPC in this app.
    const { error } = await supabase.rpc("complete_kiosk_reservation", { p_reservation_id: parsed.data.reservationId });
    if (error) throw new Error(error.message);

    revalidatePath("/settings/kiosk");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not complete reservation" };
  }
}
