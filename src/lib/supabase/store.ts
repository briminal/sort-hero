import type { createClient } from "@/lib/supabase/server";

export type MyStore = { storeId: string; role: string };

/** Resolves the caller's store + role via their store_members row.
 * Single-store assumption for now -- a multi-store switcher is a follow-up. */
export async function getMyStore(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<MyStore> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("store_members")
    .select("store_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (error || !data) throw new Error("No store found for the current user");

  return { storeId: data.store_id as string, role: data.role as string };
}
