"use client";

import { useRef, useState } from "react";
import { previewAutopricingPrice, searchCardsForConfig, updateAutopricingConfig, type PreviewResult, type SearchableCard } from "../../actions";
import type { AutopricingConfig } from "@/types/autopricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RarityBaselinesEditor } from "./rarity-baselines-editor";
import { SetModifiersEditor } from "./set-modifiers-editor";

const SOURCES = [
  { value: "market", label: "Market Price" },
  { value: "low", label: "Direct Low Price" },
  { value: "high", label: "High Price" },
  { value: "mid", label: "Mid Price" },
] as const;

const ROUNDING_OPTIONS: { value: string; label: string; cents: number | null }[] = [
  { value: "none", label: "No rounding / $0.01", cents: null },
  { value: "10", label: "Round to $0.10", cents: 10 },
  { value: "25", label: "Round to $0.25", cents: 25 },
  { value: "49", label: "Round to $0.49", cents: 49 },
  { value: "50", label: "Round to $0.50", cents: 50 },
  { value: "95", label: "Round to $0.95", cents: 95 },
  { value: "99", label: "Round to $0.99", cents: 99 },
  { value: "100", label: "Round to $1.00", cents: 100 },
];

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function roundingValueFor(cents: number | null): string {
  return ROUNDING_OPTIONS.find((o) => o.cents === cents)?.value ?? "none";
}

type TabValue = "general" | "price" | "condition" | "rarity" | "set";

export function ConfigEditor({ initialConfig }: { initialConfig: AutopricingConfig & { name: string } }) {
  const [config, setConfig] = useState(initialConfig);
  const [activeTab, setActiveTab] = useState<TabValue>("general");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [cardQuery, setCardQuery] = useState("");
  const [cardResults, setCardResults] = useState<SearchableCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<SearchableCard | null>(null);
  const [previewCondition, setPreviewCondition] = useState<(typeof CONDITIONS)[number]>("NM");
  const [previewFoil, setPreviewFoil] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const selectedCardRef = useRef(selectedCard);
  selectedCardRef.current = selectedCard;
  const previewConditionRef = useRef(previewCondition);
  previewConditionRef.current = previewCondition;
  const previewFoilRef = useRef(previewFoil);
  previewFoilRef.current = previewFoil;

  function update<K extends keyof AutopricingConfig>(field: K, value: AutopricingConfig[K]) {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    const result = await updateAutopricingConfig({ ...config, id: initialConfig.id! });
    setSaving(false);
    setSaveMessage("error" in result ? `Error: ${result.error}` : "Saved.");
    // Re-read the latest preview inputs via refs instead of the closed-over
    // condition/foil values -- the user may have changed them while the
    // save was in flight.
    if (selectedCardRef.current) runPreview(selectedCardRef.current, previewConditionRef.current, previewFoilRef.current);
  }

  async function handleCardSearch(value: string) {
    setCardQuery(value);
    if (value.trim().length < 2) {
      setCardResults([]);
      return;
    }
    const result = await searchCardsForConfig({ configId: initialConfig.id!, query: value });
    if (Array.isArray(result)) setCardResults(result);
  }

  async function runPreview(card: SearchableCard, condition: (typeof CONDITIONS)[number], foil: boolean) {
    setPreviewError(null);
    const result = await previewAutopricingPrice({ configId: initialConfig.id!, cardId: card.id, condition, foil });
    if ("error" in result) {
      setPreviewError(result.error);
      setPreview(null);
      return;
    }
    setPreview(result);
  }

  function selectCard(card: SearchableCard) {
    setSelectedCard(card);
    setCardResults([]);
    setCardQuery(card.name);
    runPreview(card, previewCondition, previewFoil);
  }

  function changeCondition(condition: (typeof CONDITIONS)[number]) {
    setPreviewCondition(condition);
    if (selectedCard) runPreview(selectedCard, condition, previewFoil);
  }

  function changeFoil(foil: boolean) {
    setPreviewFoil(foil);
    if (selectedCard) runPreview(selectedCard, previewCondition, foil);
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="general">General Settings</TabsTrigger>
          <TabsTrigger value="price">Price Modifiers</TabsTrigger>
          <TabsTrigger value="condition">Condition Modifiers</TabsTrigger>
          <TabsTrigger value="rarity">Rarity Baselines</TabsTrigger>
          <TabsTrigger value="set">Set Modifiers</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === "general" && (
      <Card>
        <CardHeader>
          <CardTitle>Price Selection</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="configName">Configuration Name</Label>
            <Input id="configName" value={config.name} onChange={(e) => update("name", e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="primarySource">Primary Price</Label>
            <Select value={config.primarySource} onValueChange={(v) => update("primarySource", v as AutopricingConfig["primarySource"])}>
              <SelectTrigger id="primarySource">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="secondarySource">Fallback Price</Label>
            <Select
              value={config.secondarySource ?? "none"}
              onValueChange={(v) => update("secondarySource", v === "none" ? null : (v as AutopricingConfig["secondarySource"]))}
            >
              <SelectTrigger id="secondarySource">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-- none --</SelectItem>
                {SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lastCallSource">Last Call Fallback</Label>
            <Select
              value={config.lastCallSource ?? "none"}
              onValueChange={(v) => update("lastCallSource", v === "none" ? null : (v as AutopricingConfig["lastCallSource"]))}
            >
              <SelectTrigger id="lastCallSource">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-- none --</SelectItem>
                {SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doomsdaySource">Doomsday Fallback</Label>
            <Select
              value={config.doomsdaySource ?? "none"}
              onValueChange={(v) => update("doomsdaySource", v === "none" ? null : (v as AutopricingConfig["doomsdaySource"]))}
            >
              <SelectTrigger id="doomsdaySource">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-- none --</SelectItem>
                {SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="repriceDay">Select Day to run</Label>
            <Select
              value={config.repriceDayOfWeek ?? "none"}
              onValueChange={(v) => update("repriceDayOfWeek", v === "none" ? null : (v as AutopricingConfig["repriceDayOfWeek"]))}
            >
              <SelectTrigger id="repriceDay">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-- not scheduled --</SelectItem>
                {DAYS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium">Price Selection Rule</p>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {(["none", "lowest", "highest"] as const).map((rule) => (
                <button
                  key={rule}
                  onClick={() => update("priceSelectionRule", rule)}
                  className={`px-4 py-1.5 text-sm font-medium ${config.priceSelectionRule === rule ? "bg-primary text-primary-foreground" : "bg-background"}`}
                >
                  {rule === "none" ? "None" : rule === "lowest" ? "Use Lowest" : "Use Highest"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rounding">Rounding Option</Label>
            <Select value={roundingValueFor(config.roundingIncrementCents)} onValueChange={(v) => update("roundingIncrementCents", ROUNDING_OPTIONS.find((o) => o.value === v)!.cents)}>
              <SelectTrigger id="rounding">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUNDING_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        <CardContent className="flex items-center gap-3 border-t border-border pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
          {saveMessage && <span className="text-sm text-muted-foreground">{saveMessage}</span>}
        </CardContent>
      </Card>
      )}

      {activeTab === "price" && (
        <Card>
          <CardHeader>
            <CardTitle>Price Modifiers</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="primaryModifier">Primary Price Modifier (%)</Label>
              <Input
                id="primaryModifier"
                type="number"
                value={config.primaryModifierPercent}
                onChange={(e) => update("primaryModifierPercent", Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="secondaryModifier">Fallback Price Modifier (%)</Label>
              <Input
                id="secondaryModifier"
                type="number"
                value={config.secondaryModifierPercent}
                onChange={(e) => update("secondaryModifierPercent", Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lastCallModifier">Last Call Price Modifier (%)</Label>
              <Input
                id="lastCallModifier"
                type="number"
                value={config.lastCallModifierPercent}
                onChange={(e) => update("lastCallModifierPercent", Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doomsdayModifier">Doomsday Price Modifier (%)</Label>
              <Input
                id="doomsdayModifier"
                type="number"
                value={config.doomsdayModifierPercent}
                onChange={(e) => update("doomsdayModifierPercent", Number(e.target.value))}
              />
            </div>
          </CardContent>
          <CardContent className="flex items-center gap-3 border-t border-border pt-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
            {saveMessage && <span className="text-sm text-muted-foreground">{saveMessage}</span>}
          </CardContent>
        </Card>
      )}

      {activeTab === "condition" && (
        <Card>
          <CardHeader>
            <CardTitle>Condition Modifiers</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nmModifier">NM Modifier (%)</Label>
              <Input id="nmModifier" type="number" value={config.nmModifierPercent} onChange={(e) => update("nmModifierPercent", Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lpModifier">LP Modifier (%)</Label>
              <Input id="lpModifier" type="number" value={config.lpModifierPercent} onChange={(e) => update("lpModifierPercent", Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mpModifier">MP Modifier (%)</Label>
              <Input id="mpModifier" type="number" value={config.mpModifierPercent} onChange={(e) => update("mpModifierPercent", Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hpModifier">HP Modifier (%)</Label>
              <Input id="hpModifier" type="number" value={config.hpModifierPercent} onChange={(e) => update("hpModifierPercent", Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dmgModifier">DM Modifier (%)</Label>
              <Input id="dmgModifier" type="number" value={config.dmgModifierPercent} onChange={(e) => update("dmgModifierPercent", Number(e.target.value))} />
            </div>
          </CardContent>
          <CardContent className="flex items-center gap-3 border-t border-border pt-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
            {saveMessage && <span className="text-sm text-muted-foreground">{saveMessage}</span>}
          </CardContent>
        </Card>
      )}

      {/* Kept mounted (hidden, not unmounted) when the tab isn't active --
          both editors hold their own in-progress unsaved edits in local
          state, and switching tabs away and back used to remount them,
          silently discarding anything not yet clicked "Save" on that row. */}
      <div className={activeTab === "rarity" ? undefined : "hidden"}>
        <RarityBaselinesEditor configId={initialConfig.id!} />
      </div>
      <div className={activeTab === "set" ? undefined : "hidden"}>
        <SetModifiersEditor configId={initialConfig.id!} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Price Preview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="previewCardSearch">Card</Label>
              <Input
                id="previewCardSearch"
                value={cardQuery}
                onChange={(e) => handleCardSearch(e.target.value)}
                placeholder="Search for a card..."
                className="w-64"
              />
              {cardResults.length > 0 && (
                <ul className="max-h-48 w-64 overflow-y-auto rounded-md border border-border bg-card">
                  {cardResults.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => selectCard(c)}
                        className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        {c.name} {c.setName && <span className="text-muted-foreground">({c.setName})</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="previewCondition">Condition</Label>
              <Select value={previewCondition} onValueChange={(v) => changeCondition(v as (typeof CONDITIONS)[number])}>
                <SelectTrigger id="previewCondition" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={previewFoil} onChange={(e) => changeFoil(e.target.checked)} className="size-4 rounded border-input" />
              Foil
            </label>
          </div>

          {previewError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {previewError}
            </p>
          )}

          {preview && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
              <div>
                <p className="font-medium text-foreground">{preview.cardName}</p>
                <p className="text-xs text-muted-foreground">
                  Market: {preview.market != null ? `$${dollars(preview.market)}` : "-"}, Low:{" "}
                  {preview.low != null ? `$${dollars(preview.low)}` : "-"}, High: {preview.high != null ? `$${dollars(preview.high)}` : "-"}
                </p>
                <Badge variant="success" className="mt-2">
                  Preview Price: ${dollars(preview.finalPriceCents)}
                </Badge>
              </div>
              <div className="flex-1 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Calculation Steps</p>
                <ul className="flex flex-col gap-0.5">
                  {preview.steps.map((step, i) => (
                    <li key={i}>
                      {step.label}: ${dollars(step.priceCents)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {!preview && !previewError && <p className="text-sm text-muted-foreground">Search for a card above to preview its price.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
