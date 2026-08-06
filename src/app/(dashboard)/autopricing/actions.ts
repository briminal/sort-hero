"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { computePrice } from "@/lib/pricing/engine";
import { computeAutopricedPrice, type AutopricingResult } from "@/lib/pricing/autopricing-engine";
import { saveRulesSchema } from "@/types/pricing";
import type { PricingRule } from "@/types/pricing";
import {
  createAutopricingConfigSchema,
  deleteAutopricingConfigSchema,
  deleteSetModifierSchema,
  previewAutopricingPriceSchema,
  saveRarityBaselinesSchema,
  saveSetModifierSchema,
  updateAutopricingConfigSchema,
  type AutopricingConfig,
  type RarityBaseline,
  type SetModifier,
} from "@/types/autopricing";

export type SaveRulesResult = { ok: true } | { error: string };

export async function saveRules(input: { rules: PricingRule[] }): Promise<SaveRulesResult> {
  const parsed = saveRulesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    // Replace-all via a single atomic RPC (see replace_pricing_rules in the
    // autopricing migration) -- a plain delete-then-insert as two separate
    // calls could wipe a store's rules with nothing to replace them if the
    // insert failed after the delete had already succeeded.
    const { error } = await supabase.rpc("replace_pricing_rules", {
      p_store_id: storeId,
      p_rules: parsed.data.rules,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/autopricing");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save rules" };
  }
}

export type ApplyResult = { priced: number; skipped: number } | { error: string };

export async function applyAutopricing(): Promise<ApplyResult> {
  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    const { data: rulesData, error: rulesError } = await supabase
      .from("pricing_rules")
      .select("id, step_order, rule_type, config, enabled")
      .eq("store_id", storeId);
    if (rulesError) throw new Error(rulesError.message);

    const rules: PricingRule[] = (rulesData ?? []).map((r) => ({
      id: r.id as string,
      stepOrder: r.step_order as number,
      ruleType: r.rule_type as PricingRule["ruleType"],
      config: r.config as Record<string, unknown>,
      enabled: r.enabled as boolean,
    }));

    const { data: items, error: itemsError } = await supabase
      .from("inventory_items")
      .select("id, condition, cards!inner(id)")
      .eq("store_id", storeId);
    if (itemsError) throw new Error(itemsError.message);

    const cardIds = [...new Set((items ?? []).map((i) => (i.cards as unknown as { id: string }).id))];

    // One batched lookup instead of one query per item -- this runs over a
    // whole store's inventory, so an N+1 query per row wouldn't scale.
    const priceByCardId = new Map<string, number>();
    if (cardIds.length > 0) {
      const { data: priceRows, error: priceError } = await supabase
        .from("card_market_prices")
        .select("card_id, market_price_cents")
        .in("card_id", cardIds);
      if (priceError) throw new Error(priceError.message);

      for (const row of priceRows ?? []) {
        if (row.market_price_cents !== null) {
          priceByCardId.set(row.card_id as string, row.market_price_cents as number);
        }
      }
    }

    let skipped = 0;
    const updates: { id: string; price_cents: number }[] = [];

    for (const item of items ?? []) {
      const cardId = (item.cards as unknown as { id: string }).id;
      const marketPriceCents = priceByCardId.get(cardId);

      if (marketPriceCents === undefined) {
        skipped++;
        continue;
      }

      const newPrice = computePrice(
        marketPriceCents,
        item.condition as "NM" | "LP" | "MP" | "HP" | "DMG",
        rules,
      );

      updates.push({ id: item.id as string, price_cents: newPrice });
    }

    // One set-based UPDATE for the whole batch instead of one round-trip per
    // item -- a store with thousands of SKUs would otherwise risk a
    // serverless function timeout partway through the loop.
    let priced = 0;
    if (updates.length > 0) {
      const { data: repriced, error: repriceError } = await supabase.rpc("bulk_reprice_inventory", {
        p_store_id: storeId,
        p_updates: updates,
      });
      if (repriceError) throw new Error(repriceError.message);
      priced = repriced as number;
    }

    revalidatePath("/inventory");
    return { priced, skipped };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not apply autopricing" };
  }
}

// --- Per-game autopricing configurations (SortSwift-parity foundation) ---
// A new, separate system from the flat pricing_rules/applyAutopricing above
// -- see the migration header comment. Not wired into "Run Autopricing" yet.

type ActionResult<T> = T | { error: string };

type ConfigRow = {
  id: string;
  game_id: string;
  name: string;
  primary_source: string;
  secondary_source: string | null;
  last_call_source: string | null;
  doomsday_source: string | null;
  price_selection_rule: string;
  rounding_increment_cents: number | null;
  primary_modifier_pct: number;
  secondary_modifier_pct: number;
  last_call_modifier_pct: number;
  doomsday_modifier_pct: number;
  nm_modifier_pct: number;
  lp_modifier_pct: number;
  mp_modifier_pct: number;
  hp_modifier_pct: number;
  dmg_modifier_pct: number;
  reprice_day_of_week: string | null;
};

function rowToConfig(row: ConfigRow): AutopricingConfig {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    primarySource: row.primary_source as AutopricingConfig["primarySource"],
    secondarySource: row.secondary_source as AutopricingConfig["secondarySource"],
    lastCallSource: row.last_call_source as AutopricingConfig["lastCallSource"],
    doomsdaySource: row.doomsday_source as AutopricingConfig["doomsdaySource"],
    priceSelectionRule: row.price_selection_rule as AutopricingConfig["priceSelectionRule"],
    roundingIncrementCents: row.rounding_increment_cents,
    primaryModifierPercent: Number(row.primary_modifier_pct),
    secondaryModifierPercent: Number(row.secondary_modifier_pct),
    lastCallModifierPercent: Number(row.last_call_modifier_pct),
    doomsdayModifierPercent: Number(row.doomsday_modifier_pct),
    nmModifierPercent: Number(row.nm_modifier_pct),
    lpModifierPercent: Number(row.lp_modifier_pct),
    mpModifierPercent: Number(row.mp_modifier_pct),
    hpModifierPercent: Number(row.hp_modifier_pct),
    dmgModifierPercent: Number(row.dmg_modifier_pct),
    repriceDayOfWeek: row.reprice_day_of_week as AutopricingConfig["repriceDayOfWeek"],
  };
}

const CONFIG_COLUMNS =
  "id, game_id, name, primary_source, secondary_source, last_call_source, doomsday_source, price_selection_rule, rounding_increment_cents, primary_modifier_pct, secondary_modifier_pct, last_call_modifier_pct, doomsday_modifier_pct, nm_modifier_pct, lp_modifier_pct, mp_modifier_pct, hp_modifier_pct, dmg_modifier_pct, reprice_day_of_week";

export type AutopricingConfigSummary = { id: string; name: string; gameId: string; gameName: string };

export async function listAutopricingConfigs(): Promise<ActionResult<AutopricingConfigSummary[]>> {
  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data, error } = await supabase
      .from("autopricing_configs")
      .select("id, name, game_id, games(name)")
      .eq("store_id", storeId)
      .order("name");
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      gameId: row.game_id as string,
      gameName: (row.games as unknown as { name: string } | null)?.name ?? "Unknown game",
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load configurations" };
  }
}

export async function getAutopricingConfig(id: string): Promise<ActionResult<AutopricingConfig & { name: string }>> {
  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data, error } = await supabase
      .from("autopricing_configs")
      .select(CONFIG_COLUMNS)
      .eq("id", id)
      .eq("store_id", storeId)
      .single();
    if (error || !data) throw new Error(error?.message ?? "Configuration not found");

    return { ...rowToConfig(data as ConfigRow), name: (data as ConfigRow).name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load configuration" };
  }
}

export async function createAutopricingConfig(input: { gameId: string; name: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = createAutopricingConfigSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data, error } = await supabase
      .from("autopricing_configs")
      .insert({ store_id: storeId, game_id: parsed.data.gameId, name: parsed.data.name })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not create configuration");

    revalidatePath("/autopricing/configs");
    return { id: data.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create configuration" };
  }
}

export async function updateAutopricingConfig(
  input: AutopricingConfig & { id: string; name: string },
): Promise<ActionResult<{ ok: true }>> {
  const parsed = updateAutopricingConfigSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { error } = await supabase
      .from("autopricing_configs")
      .update({
        name: parsed.data.name,
        game_id: parsed.data.gameId,
        primary_source: parsed.data.primarySource,
        secondary_source: parsed.data.secondarySource,
        last_call_source: parsed.data.lastCallSource,
        doomsday_source: parsed.data.doomsdaySource,
        price_selection_rule: parsed.data.priceSelectionRule,
        rounding_increment_cents: parsed.data.roundingIncrementCents,
        primary_modifier_pct: parsed.data.primaryModifierPercent,
        secondary_modifier_pct: parsed.data.secondaryModifierPercent,
        last_call_modifier_pct: parsed.data.lastCallModifierPercent,
        doomsday_modifier_pct: parsed.data.doomsdayModifierPercent,
        nm_modifier_pct: parsed.data.nmModifierPercent,
        lp_modifier_pct: parsed.data.lpModifierPercent,
        mp_modifier_pct: parsed.data.mpModifierPercent,
        hp_modifier_pct: parsed.data.hpModifierPercent,
        dmg_modifier_pct: parsed.data.dmgModifierPercent,
        reprice_day_of_week: parsed.data.repriceDayOfWeek,
      })
      .eq("id", parsed.data.id)
      .eq("store_id", storeId);
    if (error) throw new Error(error.message);

    revalidatePath(`/autopricing/configs/${parsed.data.id}`);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save configuration" };
  }
}

export async function deleteAutopricingConfig(input: { id: string }): Promise<ActionResult<{ ok: true }>> {
  const parsed = deleteAutopricingConfigSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { error } = await supabase.from("autopricing_configs").delete().eq("id", parsed.data.id).eq("store_id", storeId);
    if (error) throw new Error(error.message);

    revalidatePath("/autopricing/configs");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete configuration" };
  }
}

export type SearchableCard = { id: string; name: string; setName: string | null };

/** Card search scoped to a config's own game, for the Price Preview panel's
 * "pick a card" step. Direct table query (not the trigram search_cards RPC)
 * since a plain substring match is enough for a small preview picker. */
export async function searchCardsForConfig(input: { configId: string; query: string }): Promise<ActionResult<SearchableCard[]>> {
  if (input.query.trim().length < 2) return [];

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data: config, error: configError } = await supabase
      .from("autopricing_configs")
      .select("game_id")
      .eq("id", input.configId)
      .eq("store_id", storeId)
      .single();
    if (configError || !config) throw new Error(configError?.message ?? "Configuration not found");

    const { data, error } = await supabase
      .from("cards")
      .select("id, name, sets(name)")
      .eq("game_id", config.game_id)
      .ilike("name", `%${input.query.trim()}%`)
      .limit(20);
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      setName: (row.sets as unknown as { name: string } | null)?.name ?? null,
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Search failed" };
  }
}

export type PreviewResult = AutopricingResult & { cardName: string; market: number | null; low: number | null; high: number | null };

export async function previewAutopricingPrice(input: {
  configId: string;
  cardId: string;
  condition: string;
  foil?: boolean;
}): Promise<ActionResult<PreviewResult>> {
  const parsed = previewAutopricingPriceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data: configRow, error: configError } = await supabase
      .from("autopricing_configs")
      .select(CONFIG_COLUMNS)
      .eq("id", parsed.data.configId)
      .eq("store_id", storeId)
      .single();
    if (configError || !configRow) throw new Error(configError?.message ?? "Configuration not found");

    const { data: card, error: cardError } = await supabase.from("cards").select("name, rarity, set_id").eq("id", parsed.data.cardId).single();
    if (cardError || !card) throw new Error(cardError?.message ?? "Card not found");

    const { data: priceRow } = await supabase
      .from("card_market_prices")
      .select("market_price_cents, low_price_cents, high_price_cents")
      .eq("card_id", parsed.data.cardId)
      .maybeSingle();

    const prices = {
      market: (priceRow?.market_price_cents as number | null) ?? null,
      low: (priceRow?.low_price_cents as number | null) ?? null,
      high: (priceRow?.high_price_cents as number | null) ?? null,
    };

    let rarityBaseline: { normalBaselineCents: number | null; foilBaselineCents: number | null } | null = null;
    if (card.rarity) {
      const { data: baselineRow } = await supabase
        .from("autopricing_rarity_baselines")
        .select("normal_baseline_cents, foil_baseline_cents")
        .eq("config_id", parsed.data.configId)
        .eq("rarity", card.rarity)
        .maybeSingle();
      if (baselineRow) {
        rarityBaseline = {
          normalBaselineCents: baselineRow.normal_baseline_cents as number | null,
          foilBaselineCents: baselineRow.foil_baseline_cents as number | null,
        };
      }
    }

    let setModifier: {
      nmModifierPercent: number | null;
      lpModifierPercent: number | null;
      mpModifierPercent: number | null;
      hpModifierPercent: number | null;
      dmgModifierPercent: number | null;
    } | null = null;
    if (card.set_id) {
      const { data: setModifierRow } = await supabase
        .from("autopricing_set_modifiers")
        .select("nm_modifier_pct, lp_modifier_pct, mp_modifier_pct, hp_modifier_pct, dmg_modifier_pct")
        .eq("config_id", parsed.data.configId)
        .eq("set_id", card.set_id)
        .maybeSingle();
      if (setModifierRow) {
        setModifier = {
          nmModifierPercent: setModifierRow.nm_modifier_pct as number | null,
          lpModifierPercent: setModifierRow.lp_modifier_pct as number | null,
          mpModifierPercent: setModifierRow.mp_modifier_pct as number | null,
          hpModifierPercent: setModifierRow.hp_modifier_pct as number | null,
          dmgModifierPercent: setModifierRow.dmg_modifier_pct as number | null,
        };
      }
    }

    const config = rowToConfig(configRow as ConfigRow);
    const result = computeAutopricedPrice(
      prices,
      parsed.data.condition as "NM" | "LP" | "MP" | "HP" | "DMG",
      config,
      rarityBaseline,
      parsed.data.foil,
      setModifier,
    );
    if (!result) throw new Error("No price could be resolved for this card with the current configuration");

    return { ...result, cardName: card.name as string, ...prices };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not compute preview" };
  }
}

export async function listRarityBaselines(configId: string): Promise<ActionResult<RarityBaseline[]>> {
  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data: config, error: configError } = await supabase
      .from("autopricing_configs")
      .select("id")
      .eq("id", configId)
      .eq("store_id", storeId)
      .single();
    if (configError || !config) throw new Error(configError?.message ?? "Configuration not found");

    const { data, error } = await supabase
      .from("autopricing_rarity_baselines")
      .select("rarity, normal_baseline_cents, foil_baseline_cents")
      .eq("config_id", configId)
      .order("rarity");
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      rarity: row.rarity as string,
      normalBaselineCents: row.normal_baseline_cents as number | null,
      foilBaselineCents: row.foil_baseline_cents as number | null,
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load rarity baselines" };
  }
}

export async function saveRarityBaselines(input: { configId: string; baselines: RarityBaseline[] }): Promise<ActionResult<{ ok: true }>> {
  const parsed = saveRarityBaselinesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data: config, error: configError } = await supabase
      .from("autopricing_configs")
      .select("id")
      .eq("id", parsed.data.configId)
      .eq("store_id", storeId)
      .single();
    if (configError || !config) throw new Error(configError?.message ?? "Configuration not found");

    const { error } = await supabase.rpc("replace_autopricing_rarity_baselines", {
      p_config_id: parsed.data.configId,
      p_baselines: parsed.data.baselines,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/autopricing/configs/${parsed.data.configId}`);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save rarity baselines" };
  }
}

export type DistinctRarity = { rarity: string };

/** Rarities actually present in this config's game -- populates the "add a
 * rarity" picker with real values instead of a hardcoded guess, since
 * cards.rarity is free text sourced verbatim per-game from each external
 * catalog. */
export async function listDistinctRarities(configId: string): Promise<ActionResult<string[]>> {
  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data: config, error: configError } = await supabase
      .from("autopricing_configs")
      .select("game_id")
      .eq("id", configId)
      .eq("store_id", storeId)
      .single();
    if (configError || !config) throw new Error(configError?.message ?? "Configuration not found");

    const { data, error } = await supabase.from("cards").select("rarity").eq("game_id", config.game_id).not("rarity", "is", null);
    if (error) throw new Error(error.message);

    return [...new Set((data ?? []).map((row) => row.rarity as string))].sort();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load rarities" };
  }
}

export type SearchableSet = { id: string; name: string };

/** Set search scoped to a config's own game, for the Set Modifiers tab's
 * "find a set" step. */
export async function searchSetsForConfig(input: { configId: string; query: string }): Promise<ActionResult<SearchableSet[]>> {
  if (input.query.trim().length < 2) return [];

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data: config, error: configError } = await supabase
      .from("autopricing_configs")
      .select("game_id")
      .eq("id", input.configId)
      .eq("store_id", storeId)
      .single();
    if (configError || !config) throw new Error(configError?.message ?? "Configuration not found");

    const { data, error } = await supabase
      .from("sets")
      .select("id, name")
      .eq("game_id", config.game_id)
      .ilike("name", `%${input.query.trim()}%`)
      .limit(20);
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Search failed" };
  }
}

export async function listSetModifiers(configId: string): Promise<ActionResult<SetModifier[]>> {
  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data: config, error: configError } = await supabase
      .from("autopricing_configs")
      .select("id")
      .eq("id", configId)
      .eq("store_id", storeId)
      .single();
    if (configError || !config) throw new Error(configError?.message ?? "Configuration not found");

    const { data, error } = await supabase
      .from("autopricing_set_modifiers")
      .select("id, set_id, nm_modifier_pct, lp_modifier_pct, mp_modifier_pct, hp_modifier_pct, dmg_modifier_pct, sets(name)")
      .eq("config_id", configId);
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      setId: row.set_id as string,
      setName: (row.sets as unknown as { name: string } | null)?.name ?? "Unknown set",
      nmModifierPercent: row.nm_modifier_pct as number | null,
      lpModifierPercent: row.lp_modifier_pct as number | null,
      mpModifierPercent: row.mp_modifier_pct as number | null,
      hpModifierPercent: row.hp_modifier_pct as number | null,
      dmgModifierPercent: row.dmg_modifier_pct as number | null,
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load set modifiers" };
  }
}

export async function saveSetModifier(input: {
  configId: string;
  setId: string;
  nmModifierPercent: number | null;
  lpModifierPercent: number | null;
  mpModifierPercent: number | null;
  hpModifierPercent: number | null;
  dmgModifierPercent: number | null;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = saveSetModifierSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data: config, error: configError } = await supabase
      .from("autopricing_configs")
      .select("id")
      .eq("id", parsed.data.configId)
      .eq("store_id", storeId)
      .single();
    if (configError || !config) throw new Error(configError?.message ?? "Configuration not found");

    const { data, error } = await supabase.rpc("upsert_autopricing_set_modifier", {
      p_config_id: parsed.data.configId,
      p_set_id: parsed.data.setId,
      p_nm_modifier_pct: parsed.data.nmModifierPercent,
      p_lp_modifier_pct: parsed.data.lpModifierPercent,
      p_mp_modifier_pct: parsed.data.mpModifierPercent,
      p_hp_modifier_pct: parsed.data.hpModifierPercent,
      p_dmg_modifier_pct: parsed.data.dmgModifierPercent,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/autopricing/configs/${parsed.data.configId}`);
    return { id: data as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save set modifier" };
  }
}

export async function deleteSetModifier(input: { id: string }): Promise<ActionResult<{ ok: true }>> {
  const parsed = deleteSetModifierSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();

  try {
    // RLS (via the parent config's store) is what actually enforces
    // store-scoping here -- no need to re-derive storeId first.
    const { error } = await supabase.from("autopricing_set_modifiers").delete().eq("id", parsed.data.id);
    if (error) throw new Error(error.message);

    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete set modifier" };
  }
}
