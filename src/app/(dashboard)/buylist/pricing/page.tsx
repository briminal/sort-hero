import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { DEFAULT_BUYLIST_PRICING_RULES, type BuylistPricingRule, type PriceSourceConfig } from "@/types/buylist-pricing";
import { BuylistPricingEditor, type GameOption } from "./buylist-pricing-editor";

export default async function BuylistPricingPage() {
  const supabase = await createClient();
  const { storeId } = await getMyStore(supabase);

  const [gamesResult, rulesResult, sourceConfigResult] = await Promise.all([
    supabase.from("games").select("id, code, name").order("name"),
    supabase
      .from("buylist_pricing_rules")
      .select("id, game_id, set_id, step_order, rule_type, config, enabled")
      .eq("store_id", storeId),
    supabase.from("buylist_price_source_config").select("*").eq("store_id", storeId),
  ]);

  if (gamesResult.error) {
    return (
      <main className="p-6">
        <h1 className="text-lg font-semibold">Buy pricing rules</h1>
        <p role="alert" className="mt-2 text-sm text-destructive">
          Could not load games: {gamesResult.error.message}
        </p>
      </main>
    );
  }

  const games = (gamesResult.data ?? []) as GameOption[];

  // Keyed by "{gameId|global}::{setId|none}" -- matches the editor's scope
  // key, so a set-scoped override never gets mixed in with its game's
  // whole-game rules.
  const rulesByScope: Record<string, BuylistPricingRule[]> = {};
  for (const row of rulesResult.data ?? []) {
    const gameKey = (row.game_id as string | null) ?? "global";
    const setKey = (row.set_id as string | null) ?? "none";
    const rule: BuylistPricingRule = {
      id: row.id as string,
      gameId: (row.game_id as string | null) ?? null,
      setId: (row.set_id as string | null) ?? null,
      stepOrder: row.step_order as number,
      ruleType: row.rule_type as BuylistPricingRule["ruleType"],
      config: row.config as Record<string, unknown>,
      enabled: row.enabled as boolean,
    };
    (rulesByScope[`${gameKey}::${setKey}`] ??= []).push(rule);
  }
  for (const rules of Object.values(rulesByScope)) {
    rules.sort((a, b) => a.stepOrder - b.stepOrder);
  }
  // No global rules saved yet -- seed with the same defaults every store
  // used to get before per-game/per-set scoping existed.
  if (!rulesByScope["global::none"]) {
    rulesByScope["global::none"] = DEFAULT_BUYLIST_PRICING_RULES.map((r, i) => ({ ...r, id: `default-${i}` }));
  }

  const sourceConfigByGame: Record<string, PriceSourceConfig> = {};
  for (const row of sourceConfigResult.data ?? []) {
    const key = (row.game_id as string | null) ?? "global";
    sourceConfigByGame[key] = {
      gameId: (row.game_id as string | null) ?? null,
      primarySource: row.primary_source,
      secondarySource: row.secondary_source,
      lastCallSource: row.last_call_source,
      doomsdaySource: row.doomsday_source,
      primaryModifierPercent: Number(row.primary_modifier_pct),
      secondaryModifierPercent: Number(row.secondary_modifier_pct),
      lastCallModifierPercent: Number(row.last_call_modifier_pct),
      doomsdayModifierPercent: Number(row.doomsday_modifier_pct),
    };
  }

  return (
    <main className="flex flex-col gap-4 p-6">
      <div>
        <Link href="/buylist" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to buylist
        </Link>
        <h1 className="mt-2 text-lg font-semibold">Buy pricing rules</h1>
        <p className="text-sm text-muted-foreground">
          Configure how much the shop offers customers for cards, by condition -- optionally per game, or per set within a game.
        </p>
      </div>
      <BuylistPricingEditor games={games} rulesByScope={rulesByScope} sourceConfigByGame={sourceConfigByGame} />
    </main>
  );
}
