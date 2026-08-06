"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { AMBIGUOUS_SCORE_GAP, MATCH_THRESHOLD, matchCards, type CardCandidate } from "@/lib/recognition/match";
import { commitImportSchema, previewImportSchema, type MappedRow } from "@/types/csv";

export type PreviewedRow = {
  row: MappedRow;
  status: "matched" | "ambiguous" | "unmatched";
  candidates: CardCandidate[];
  matchedCardId: string | null;
};

export type PreviewResult = { rows: PreviewedRow[] } | { error: string };

export async function previewImportRows(input: {
  gameCode: string;
  rows: MappedRow[];
}): Promise<PreviewResult> {
  const parsed = previewImportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const results: PreviewedRow[] = [];

    // Cache matches per unique name -- CSVs commonly repeat the same card
    // across multiple rows (different conditions/quantities).
    const cache = new Map<string, CardCandidate[]>();

    for (const row of parsed.data.rows) {
      const key = row.name.toLowerCase();
      let candidates = cache.get(key);
      if (!candidates) {
        candidates = await matchCards(supabase, parsed.data.gameCode, row.name, 3);
        cache.set(key, candidates);
      }

      const top = candidates[0];
      if (top && top.score >= MATCH_THRESHOLD) {
        const second = candidates[1];
        const clearlyBest = !second || top.score - second.score > AMBIGUOUS_SCORE_GAP;
        results.push({
          row,
          status: clearlyBest ? "matched" : "ambiguous",
          candidates,
          matchedCardId: clearlyBest ? top.id : null,
        });
      } else {
        results.push({ row, status: "unmatched", candidates, matchedCardId: null });
      }
    }

    return { rows: results };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Preview failed" };
  }
}

export type CommitResult = { inserted: number; updated: number } | { error: string };

export async function commitImportRows(input: {
  gameCode: string;
  rows: (MappedRow & { cardId: string })[];
}): Promise<CommitResult> {
  const parsed = commitImportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    // Runs as a single DB transaction (commit_inventory_import) instead of
    // one Supabase call per row -- a mid-import failure (bad card_id, a
    // transient error) rolls back every row from this commit instead of
    // leaving a partial import that would insert duplicates on retry.
    const { data, error } = await supabase.rpc("commit_inventory_import", {
      p_store_id: storeId,
      p_rows: parsed.data.rows.map((row) => ({
        id: row.id ?? null,
        cardId: row.cardId,
        quantity: row.quantity ?? 1,
        condition: row.condition ?? "NM",
        priceCents: row.priceCents ?? null,
        notes: row.notes ?? null,
      })),
    });
    if (error) throw new Error(error.message);

    revalidatePath("/inventory");
    revalidatePath("/inventory/editor");
    return { inserted: (data as { inserted: number }).inserted, updated: (data as { updated: number }).updated };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Import failed" };
  }
}
