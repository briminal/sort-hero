"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { idsSchema, updateInventoryItemSchema } from "@/types/inventory";

export type ActionResult = { ok: true } | { error: string };

export async function updateInventoryItem(input: {
  id: string;
  quantity?: number;
  condition?: string;
  priceCents?: number | null;
  notes?: string | null;
  status?: string;
  expectedUpdatedAt?: string | null;
}): Promise<ActionResult> {
  const parsed = updateInventoryItemSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { id, quantity, condition, priceCents, notes, status, expectedUpdatedAt } = parsed.data;
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (quantity !== undefined) patch.quantity = quantity;
  if (condition !== undefined) patch.condition = condition;
  if (priceCents !== undefined) patch.price_cents = priceCents;
  if (notes !== undefined) patch.notes = notes;
  if (status !== undefined) patch.status = status;

  // Same lost-update guard as the bulk editor: condition the write on
  // updated_at not having changed since load, so two staff editing the same
  // row don't silently clobber each other via this quick-edit list.
  let query = supabase.from("inventory_items").update(patch, { count: "exact" }).eq("id", id);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
  const { count, error } = await query;
  if (error) return { error: error.message };
  if (expectedUpdatedAt && !count) {
    return { error: "Changed by someone else since you loaded it -- refresh and reapply this edit" };
  }

  revalidatePath("/inventory");
  return { ok: true };
}

export async function deleteInventoryItem(input: { id: string }): Promise<ActionResult> {
  const parsed = idsSchema.safeParse({ ids: [input.id] });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("inventory_items")
    .delete({ count: "exact" })
    .eq("id", input.id);

  if (error) return { error: error.message };
  if (!count) return { error: "Not permitted (owner-only)" };

  revalidatePath("/inventory");
  return { ok: true };
}

export async function bulkDeleteItems(input: { ids: string[] }): Promise<ActionResult> {
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("inventory_items").delete().in("id", parsed.data.ids);
  if (error) return { error: error.message };

  revalidatePath("/inventory");
  return { ok: true };
}

export async function bulkConfirmItems(input: { ids: string[] }): Promise<ActionResult> {
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_items")
    .update({ status: "confirmed" })
    .in("id", parsed.data.ids);

  if (error) return { error: error.message };

  revalidatePath("/inventory");
  return { ok: true };
}
