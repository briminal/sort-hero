"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveGamesQuery, type ActiveGame } from "@/lib/games";

export type GetActiveGamesResult = { games: ActiveGame[] } | { error: string };

/** Shared across every client component (dashboard and public alike) that
 * needs a game dropdown -- one place to change if the games list changes,
 * instead of the ~6 files that used to hardcode "mtg/pokemon/yugioh". */
export async function getActiveGames(): Promise<GetActiveGamesResult> {
  try {
    const supabase = await createClient();
    const games = await getActiveGamesQuery(supabase);
    return { games };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load games" };
  }
}
