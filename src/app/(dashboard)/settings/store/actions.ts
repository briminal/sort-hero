"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { updateStoreTaxSettingsSchema } from "@/types/store-settings";

type ActionResult<T> = T | { error: string };

export async function updateStoreTaxSettings(input: {
  taxRatePercent: number;
  roundToNearestCents: number | null;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = updateStoreTaxSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    const supabase = await createClient();
    const { storeId, role } = await getMyStore(supabase);
    if (role !== "owner") throw new Error("Only a store owner can change tax settings");

    const { error } = await supabase
      .from("stores")
      .update({ tax_rate_percent: parsed.data.taxRatePercent, round_to_nearest_cents: parsed.data.roundToNearestCents })
      .eq("id", storeId);
    if (error) throw new Error(error.message);

    revalidatePath("/settings/store");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update tax settings" };
  }
}
