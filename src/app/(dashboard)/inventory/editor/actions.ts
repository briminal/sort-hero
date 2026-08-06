"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { bulkEditSchema, type UpdateInventoryItemInput } from "@/types/inventory";

export type SaveEditsResult =
  | { updated: number; failed: { id: string; reason: string }[] }
  | { error: string };

export async function saveInventoryEdits(input: {
  edits: UpdateInventoryItemInput[];
}): Promise<SaveEditsResult> {
  const parsed = bulkEditSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  let updated = 0;
  const failed: { id: string; reason: string }[] = [];

  for (const edit of parsed.data.edits) {
    const patch: Record<string, unknown> = {};
    if (edit.quantity !== undefined) patch.quantity = edit.quantity;
    if (edit.condition !== undefined) patch.condition = edit.condition;
    if (edit.priceCents !== undefined) patch.price_cents = edit.priceCents;
    if (edit.costCents !== undefined) patch.cost_cents = edit.costCents;
    if (edit.notes !== undefined) patch.notes = edit.notes;
    if (edit.status !== undefined) patch.status = edit.status;

    // RLS (is_store_member) is what actually enforces store-scoping here --
    // an id belonging to another store (or a stale id) simply updates 0
    // rows rather than erroring, so that's reported as a per-row failure
    // rather than silently treated as a success. When the caller tracked
    // updated_at, the write is also conditioned on it not having changed
    // since load -- otherwise two staff editing the same row (one on stale
    // data) would silently overwrite each other's change instead of the
    // second save failing loudly.
    let query = supabase.from("inventory_items").update(patch, { count: "exact" }).eq("id", edit.id);
    if (edit.expectedUpdatedAt) query = query.eq("updated_at", edit.expectedUpdatedAt);
    const { count, error } = await query;

    if (error) {
      failed.push({ id: edit.id, reason: error.message });
    } else if (!count) {
      failed.push({
        id: edit.id,
        reason: edit.expectedUpdatedAt
          ? "Changed by someone else since you loaded it -- refresh and reapply this edit"
          : "Not found or not permitted",
      });
    } else {
      updated++;
    }
  }

  if (updated > 0) revalidatePath("/inventory/editor");

  return { updated, failed };
}
