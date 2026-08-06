import type { SupabaseClient } from "@supabase/supabase-js";

export async function getGameId(admin: SupabaseClient, code: string): Promise<string> {
  const { data, error } = await admin.from("games").select("id").eq("code", code).single();

  if (error || !data) {
    throw new Error(`Could not find game with code "${code}": ${error?.message ?? "not found"}`);
  }

  return data.id as string;
}
