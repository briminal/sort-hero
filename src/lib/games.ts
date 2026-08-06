import type { SupabaseClient } from "@supabase/supabase-js";

export type ActiveGame = { code: string; name: string };

/** Plain query, usable directly from any Server Component with a supabase
 * client -- `games` grants select to anon+authenticated with a `using
 * (true)` policy, so this is safe from both dashboard and public pages. */
export async function getActiveGamesQuery(supabase: SupabaseClient): Promise<ActiveGame[]> {
  const { data, error } = await supabase.from("games").select("code, name").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ActiveGame[];
}
