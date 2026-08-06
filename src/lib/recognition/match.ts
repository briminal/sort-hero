import type { SupabaseClient } from "@supabase/supabase-js";

// Shared between CSV import and bulk scanning -- both preview steps sort
// OCR/name matches into matched/ambiguous/unmatched using the same cutoffs.
export const MATCH_THRESHOLD = 0.4;
export const AMBIGUOUS_SCORE_GAP = 0.05;

export type CardCandidate = {
  id: string;
  name: string;
  set_name: string | null;
  collector_number: string | null;
  image_url: string | null;
  rarity: string | null;
  score: number;
};

export async function matchCards(
  supabase: SupabaseClient,
  gameCode: string,
  query: string,
  limit = 5,
  setId: string | null = null,
): Promise<CardCandidate[]> {
  const { data, error } = await supabase.rpc("search_cards", {
    p_game_code: gameCode,
    p_query: query,
    p_limit: limit,
    p_set_id: setId,
  });

  if (error) throw new Error(`search_cards failed: ${error.message}`);

  return (data ?? []) as CardCandidate[];
}
