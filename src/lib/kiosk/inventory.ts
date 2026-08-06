import { getServiceClient } from "@/lib/supabase/service";

export type KioskInventoryRow = {
  inventoryItemId: string;
  cardId: string;
  cardName: string;
  setId: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string | null;
  condition: string;
  printing: string;
  language: string;
  quantity: number;
  priceCents: number | null;
};

export type BrowseKioskInventoryParams = {
  storeId: string;
  gameCode?: string;
  query?: string;
  setId?: string;
  rarity?: string;
  sort?: "name_asc" | "price_asc" | "price_desc";
  limit?: number;
  offset?: number;
};

/** No next/headers import -- callable directly from the standalone tsx
 * verification script. */
export async function browseKioskInventoryCore(params: BrowseKioskInventoryParams): Promise<KioskInventoryRow[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("kiosk_browse_inventory", {
    p_store_id: params.storeId,
    p_game_code: params.gameCode ?? null,
    p_query: params.query ?? null,
    p_set_id: params.setId ?? null,
    p_rarity: params.rarity ?? null,
    p_sort: params.sort ?? "name_asc",
    p_limit: params.limit ?? 24,
    p_offset: params.offset ?? 0,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    inventoryItemId: row.inventory_item_id as string,
    cardId: row.card_id as string,
    cardName: row.card_name as string,
    setId: (row.set_id as string | null) ?? null,
    setName: (row.set_name as string | null) ?? null,
    rarity: (row.rarity as string | null) ?? null,
    imageUrl: (row.image_url as string | null) ?? null,
    condition: row.condition as string,
    printing: row.printing as string,
    language: row.language as string,
    quantity: row.quantity as number,
    priceCents: (row.price_cents as number | null) ?? null,
  }));
}

export type KioskFilterOptions = {
  sets: { id: string; name: string }[];
  rarities: string[];
};

export async function kioskAvailableFiltersCore(storeId: string, gameCode?: string): Promise<KioskFilterOptions> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .rpc("kiosk_available_filters", { p_store_id: storeId, p_game_code: gameCode ?? null })
    .single();
  if (error) throw new Error(error.message);

  const row = data as { sets: { id: string; name: string }[]; rarities: string[] };
  return { sets: row.sets ?? [], rarities: row.rarities ?? [] };
}
