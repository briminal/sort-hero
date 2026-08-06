"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { getSetsForGame, saveBuylistPriceSourceConfig, saveBuylistPricingRules } from "../actions";
import type { BuylistPricingRule, BuylistRuleType, PriceSource, PriceSourceConfig, TieredPriceTier } from "@/types/buylist-pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type GameOption = { id: string; code: string; name: string };
type SetOption = { id: string; name: string };

const RULE_LABELS: Record<BuylistRuleType, string> = {
  condition_multiplier: "Condition multiplier",
  margin_percent: "Margin %",
  margin_fixed: "Margin (fixed cents)",
  round_to_nearest: "Round to nearest",
  min_price: "Minimum price",
  max_price: "Maximum price",
  tiered_price: "Tiered price (cash/credit)",
};

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
const PRICE_SOURCES: PriceSource[] = ["market", "low", "high", "mid"];
const NO_GAME = "__all__";
const NO_SET = "__whole_game__";

function defaultConfigFor(ruleType: BuylistRuleType): Record<string, unknown> {
  switch (ruleType) {
    case "condition_multiplier":
      return { NM: 100, LP: 80, MP: 60, HP: 35, DMG: 15 };
    case "margin_percent":
      return { percent: -40 };
    case "round_to_nearest":
      return { cents: 25 };
    case "margin_fixed":
    case "min_price":
    case "max_price":
      return { cents: 0 };
    case "tiered_price":
      return { tiers: [], fallbackCashPercent: -40, fallbackCreditPercent: -25 };
  }
}

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === "number" ? value : fallback;
}

function tiersOf(config: Record<string, unknown>): TieredPriceTier[] {
  return Array.isArray(config.tiers) ? (config.tiers as TieredPriceTier[]) : [];
}

const fieldClass =
  "flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function TieredPriceEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const tiers = tiersOf(config);

  function updateTier(index: number, next: TieredPriceTier) {
    onChange({ ...config, tiers: tiers.map((t, i) => (i === index ? next : t)) });
  }

  function removeTier(index: number) {
    onChange({ ...config, tiers: tiers.filter((_, i) => i !== index) });
  }

  function addTier() {
    onChange({
      ...config,
      tiers: [...tiers, { minCents: 0, maxCents: null, type: "fixed", cashValue: 0, creditValue: 0, rarities: [] }],
    });
  }

  return (
    <div data-testid="tiered-price-config" className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-col gap-2">
        {tiers.map((tier, i) => (
          <div
            key={i}
            data-testid="tiered-price-tier"
            className="grid grid-cols-2 gap-2 rounded-md border border-border bg-background p-2 sm:grid-cols-3 lg:grid-cols-6"
          >
            <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              Min ($)
              <input
                type="number"
                value={tier.minCents / 100}
                onChange={(e) => updateTier(i, { ...tier, minCents: Math.round(Number(e.target.value) * 100) })}
                aria-label={`Tier ${i} minimum`}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              Max ($, blank = no limit)
              <input
                type="number"
                value={tier.maxCents == null ? "" : tier.maxCents / 100}
                onChange={(e) =>
                  updateTier(i, { ...tier, maxCents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })
                }
                aria-label={`Tier ${i} maximum`}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              Type
              <select
                value={tier.type}
                onChange={(e) => updateTier(i, { ...tier, type: e.target.value as "fixed" | "percent" })}
                aria-label={`Tier ${i} value type`}
                className={fieldClass}
              >
                <option value="fixed">Fixed price ($)</option>
                <option value="percent">Percent of price</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              Cash value
              <input
                type="number"
                value={tier.cashValue}
                onChange={(e) => updateTier(i, { ...tier, cashValue: Number(e.target.value) })}
                aria-label={`Tier ${i} cash value`}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              Credit value
              <input
                type="number"
                value={tier.creditValue}
                onChange={(e) => updateTier(i, { ...tier, creditValue: Number(e.target.value) })}
                aria-label={`Tier ${i} credit value`}
                className={fieldClass}
              />
            </label>
            <div className="flex items-end gap-1">
              <label className="flex flex-1 flex-col gap-0.5 text-xs text-muted-foreground">
                Rarities (comma-separated)
                <input
                  type="text"
                  value={(tier.rarities ?? []).join(", ")}
                  onChange={(e) =>
                    updateTier(i, {
                      ...tier,
                      rarities: e.target.value
                        .split(",")
                        .map((r) => r.trim())
                        .filter(Boolean),
                    })
                  }
                  aria-label={`Tier ${i} rarities`}
                  className={fieldClass}
                />
              </label>
              <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" onClick={() => removeTier(i)}>
                <X className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" className="self-start" onClick={addTier}>
        + Add tier
      </Button>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          Fallback cash % (no tier matches)
          <input
            type="number"
            value={num(config, "fallbackCashPercent", 0)}
            onChange={(e) => onChange({ ...config, fallbackCashPercent: Number(e.target.value) })}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          Fallback credit % (no tier matches)
          <input
            type="number"
            value={num(config, "fallbackCreditPercent", 0)}
            onChange={(e) => onChange({ ...config, fallbackCreditPercent: Number(e.target.value) })}
            className={fieldClass}
          />
        </label>
      </div>
    </div>
  );
}

function SortableRule({
  rule,
  onChange,
  onRemove,
}: {
  rule: BuylistPricingRule;
  onChange: (next: BuylistPricingRule) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id!,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      data-testid="buylist-pricing-rule"
      data-rule-type={rule.ruleType}
      className={cn("gap-0", isDragging && "opacity-60")}
    >
      <CardHeader className="flex-row items-center gap-2 p-3">
        <span
          {...attributes}
          {...listeners}
          role="button"
          aria-label={`Drag to reorder ${RULE_LABELS[rule.ruleType]}`}
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
        <CardTitle className="flex-1 text-sm">{RULE_LABELS[rule.ruleType]}</CardTitle>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
            className="size-3.5 rounded border-input"
          />
          Enabled
        </label>

        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={onRemove}>
          <X className="size-4" />
        </Button>
      </CardHeader>

      {(rule.ruleType === "condition_multiplier" ||
        rule.ruleType === "margin_percent" ||
        rule.ruleType === "margin_fixed" ||
        rule.ruleType === "round_to_nearest" ||
        rule.ruleType === "min_price" ||
        rule.ruleType === "max_price" ||
        rule.ruleType === "tiered_price") && (
        <CardContent className="p-3 pt-0">
          {rule.ruleType === "condition_multiplier" && (
            <div className="grid grid-cols-5 gap-2">
              {CONDITIONS.map((c) => (
                <label key={c} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {c}
                  <input
                    type="number"
                    value={num(rule.config, c, 100)}
                    onChange={(e) => onChange({ ...rule, config: { ...rule.config, [c]: Number(e.target.value) } })}
                    aria-label={`${c} percent`}
                    className={fieldClass}
                  />
                </label>
              ))}
            </div>
          )}

          {rule.ruleType === "margin_percent" && (
            <label className="flex max-w-40 flex-col gap-0.5 text-xs text-muted-foreground">
              Percent
              <input
                type="number"
                value={num(rule.config, "percent", 0)}
                onChange={(e) => onChange({ ...rule, config: { percent: Number(e.target.value) } })}
                aria-label="Margin percent value"
                className={fieldClass}
              />
            </label>
          )}

          {(rule.ruleType === "margin_fixed" ||
            rule.ruleType === "round_to_nearest" ||
            rule.ruleType === "min_price" ||
            rule.ruleType === "max_price") && (
            <label className="flex max-w-40 flex-col gap-0.5 text-xs text-muted-foreground">
              Cents
              <input
                type="number"
                value={num(rule.config, "cents", 0)}
                onChange={(e) => onChange({ ...rule, config: { cents: Number(e.target.value) } })}
                aria-label={`${RULE_LABELS[rule.ruleType]} value`}
                className={fieldClass}
              />
            </label>
          )}

          {rule.ruleType === "tiered_price" && (
            <TieredPriceEditor config={rule.config} onChange={(config) => onChange({ ...rule, config })} />
          )}
        </CardContent>
      )}
    </Card>
  );
}

function PriceSourceConfigEditor({
  config,
  onChange,
}: {
  config: PriceSourceConfig;
  onChange: (config: PriceSourceConfig) => void;
}) {
  return (
    <Card data-testid="price-source-config">
      <CardHeader>
        <CardTitle>Fallback price source chain</CardTitle>
        <p className="text-xs text-muted-foreground">When a card has no price at the primary source, each step below is tried in order.</p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            { key: "primarySource", modifierKey: "primaryModifierPercent", label: "Primary" },
            { key: "secondarySource", modifierKey: "secondaryModifierPercent", label: "Secondary" },
            { key: "lastCallSource", modifierKey: "lastCallModifierPercent", label: "Last call" },
            { key: "doomsdaySource", modifierKey: "doomsdayModifierPercent", label: "Doomsday" },
          ] as const
        ).map(({ key, modifierKey, label }) => (
          <div key={key} className="flex flex-col gap-2 rounded-md border border-border p-2">
            <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {label} source
              <select
                value={config[key] ?? ""}
                onChange={(e) => onChange({ ...config, [key]: e.target.value === "" ? null : (e.target.value as PriceSource) })}
                aria-label={`${label} source`}
                className={fieldClass}
              >
                <option value="">-- none --</option>
                {PRICE_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              Modifier %
              <input
                type="number"
                value={config[modifierKey]}
                onChange={(e) => onChange({ ...config, [modifierKey]: Number(e.target.value) })}
                aria-label={`${label} modifier percent`}
                className={fieldClass}
              />
            </label>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function BuylistPricingEditor({
  games,
  rulesByScope,
  sourceConfigByGame,
}: {
  games: GameOption[];
  rulesByScope: Record<string, BuylistPricingRule[]>;
  sourceConfigByGame: Record<string, PriceSourceConfig>;
}) {
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [sets, setSets] = useState<SetOption[]>([]);
  const [rulesByScopeState, setRulesByScopeState] = useState(rulesByScope);
  const [sourceConfigByGameState, setSourceConfigByGameState] = useState(sourceConfigByGame);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Sets are only meaningful within a specific game, so switching games
  // resets the set selection and re-fetches that game's sets.
  useEffect(() => {
    setSelectedSetId(null);
    if (!selectedGameId) {
      setSets([]);
      return;
    }
    getSetsForGame(selectedGameId).then((result) => {
      if (Array.isArray(result)) setSets(result);
    });
  }, [selectedGameId]);

  const gameKey = selectedGameId ?? "global";
  const scopeKey = `${gameKey}::${selectedSetId ?? "none"}`;
  const rules = rulesByScopeState[scopeKey] ?? [];
  const sourceConfig: PriceSourceConfig = sourceConfigByGameState[gameKey] ?? {
    gameId: selectedGameId,
    primarySource: "market",
    secondarySource: null,
    lastCallSource: null,
    doomsdaySource: null,
    primaryModifierPercent: 0,
    secondaryModifierPercent: 0,
    lastCallModifierPercent: 0,
    doomsdayModifierPercent: 0,
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function setRules(next: BuylistPricingRule[]) {
    setRulesByScopeState((prev) => ({ ...prev, [scopeKey]: next }));
  }

  function setSourceConfig(next: PriceSourceConfig) {
    setSourceConfigByGameState((prev) => ({ ...prev, [gameKey]: next }));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = rules.findIndex((r) => r.id === active.id);
    const newIndex = rules.findIndex((r) => r.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setRules(arrayMove(rules, oldIndex, newIndex).map((r, i) => ({ ...r, stepOrder: i })));
  }

  function updateRule(id: string, next: BuylistPricingRule) {
    setRules(rules.map((r) => (r.id === id ? next : r)));
  }

  function removeRule(id: string) {
    setRules(rules.filter((r) => r.id !== id).map((r, i) => ({ ...r, stepOrder: i })));
  }

  function addRule(ruleType: BuylistRuleType) {
    setRules([
      ...rules,
      {
        id: crypto.randomUUID(),
        gameId: selectedGameId,
        setId: selectedSetId,
        stepOrder: rules.length,
        ruleType,
        config: defaultConfigFor(ruleType),
        enabled: true,
      },
    ]);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    const [rulesResult, sourceResult] = await Promise.all([
      saveBuylistPricingRules({ gameId: selectedGameId, setId: selectedSetId, rules }),
      saveBuylistPriceSourceConfig({ ...sourceConfig, gameId: selectedGameId }),
    ]);
    setSaving(false);
    const error = "error" in rulesResult ? rulesResult.error : "error" in sourceResult ? sourceResult.error : null;
    setSaveMessage(error ? `Error: ${error}` : "Saved.");
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pricingGameSelect">Game</Label>
            <Select
              value={selectedGameId ?? NO_GAME}
              onValueChange={(v) => setSelectedGameId(v === NO_GAME ? null : v)}
            >
              <SelectTrigger id="pricingGameSelect" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GAME}>All games (default rules)</SelectItem>
                {games.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedGameId && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pricingSetSelect">Set (optional override)</Label>
              <Select
                value={selectedSetId ?? NO_SET}
                onValueChange={(v) => setSelectedSetId(v === NO_SET ? null : v)}
              >
                <SelectTrigger id="pricingSetSelect" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SET}>Whole game (no set override)</SelectItem>
                  {sets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedSetId && <Badge variant="secondary">Editing a set-level override</Badge>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(RULE_LABELS) as BuylistRuleType[]).map((rt) => (
          <Button key={rt} variant="outline" size="sm" onClick={() => addRule(rt)}>
            + {RULE_LABELS[rt]}
          </Button>
        ))}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rules.map((r) => r.id!)} strategy={verticalListSortingStrategy}>
          <div data-testid="buylist-rules-list" className="flex flex-col gap-2">
            {rules.length === 0 && (
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                No rules yet for this scope -- add one above.
              </p>
            )}
            {rules.map((rule) => (
              <SortableRule
                key={rule.id}
                rule={rule}
                onChange={(next) => updateRule(rule.id!, next)}
                onRemove={() => removeRule(rule.id!)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <PriceSourceConfigEditor config={sourceConfig} onChange={setSourceConfig} />

      <Card>
        <CardFooter className="items-center gap-3 pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save rules"}
          </Button>
          {saveMessage && (
            <span data-testid="save-message" className="text-sm text-muted-foreground">
              {saveMessage}
            </span>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
