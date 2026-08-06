"use client";

import { useEffect, useState } from "react";
import { listDistinctRarities, listRarityBaselines, saveRarityBaselines } from "../../actions";
import type { RarityBaseline } from "@/types/autopricing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

function dollarsInput(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function parseDollars(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function RarityBaselinesEditor({ configId }: { configId: string }) {
  const [baselines, setBaselines] = useState<RarityBaseline[]>([]);
  const [availableRarities, setAvailableRarities] = useState<string[]>([]);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [newRarity, setNewRarity] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listRarityBaselines(configId), listDistinctRarities(configId)]).then(([baselinesResult, raritiesResult]) => {
      if (Array.isArray(baselinesResult)) setBaselines(baselinesResult);
      if (Array.isArray(raritiesResult)) setAvailableRarities(raritiesResult);
      setLoading(false);
    });
  }, [configId]);

  function updateRow(rarity: string, field: "normalBaselineCents" | "foilBaselineCents", value: number | null) {
    setBaselines((prev) => prev.map((b) => (b.rarity === rarity ? { ...b, [field]: value } : b)));
  }

  function removeRow(rarity: string) {
    setBaselines((prev) => prev.filter((b) => b.rarity !== rarity));
  }

  function addRow() {
    const rarity = newRarity.trim();
    if (!rarity || baselines.some((b) => b.rarity === rarity)) return;
    setBaselines((prev) => [...prev, { rarity, normalBaselineCents: null, foilBaselineCents: null }]);
    setNewRarity("");
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    const result = await saveRarityBaselines({ configId, baselines });
    setSaving(false);
    setSaveMessage("error" in result ? `Error: ${result.error}` : "Saved.");
  }

  if (loading) return null;

  const unusedRarities = availableRarities.filter((r) => !baselines.some((b) => b.rarity === r));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Rarity Baseline Prices</CardTitle>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={advancedMode} onChange={(e) => setAdvancedMode(e.target.checked)} className="size-4 rounded border-input" />
          Advanced Mode
        </label>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          A floor price per rarity -- used as the starting price when a card has no market data at all, and as a minimum the computed
          price is never allowed to drop below otherwise.
          {advancedMode
            ? " Advanced Mode splits each rarity into separate normal and foil baselines."
            : " Enable Advanced Mode to set a separate foil baseline."}
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {baselines.map((row) => (
            <div key={row.rarity} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium capitalize">{row.rarity}</p>
                <button aria-label={`Remove ${row.rarity}`} onClick={() => removeRow(row.rarity)} className="text-muted-foreground hover:text-destructive">
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-0.5">
                  <Label htmlFor={`normal-${row.rarity}`} className="text-xs">
                    {advancedMode ? "Normal Baseline Price" : "Baseline Price"}
                  </Label>
                  <Input
                    id={`normal-${row.rarity}`}
                    type="number"
                    step="0.01"
                    value={dollarsInput(row.normalBaselineCents)}
                    onChange={(e) => updateRow(row.rarity, "normalBaselineCents", parseDollars(e.target.value))}
                  />
                </div>
                {advancedMode && (
                  <div className="flex flex-1 flex-col gap-0.5">
                    <Label htmlFor={`foil-${row.rarity}`} className="text-xs">
                      Foil Baseline Price
                    </Label>
                    <Input
                      id={`foil-${row.rarity}`}
                      type="number"
                      step="0.01"
                      value={dollarsInput(row.foilBaselineCents)}
                      onChange={(e) => updateRow(row.rarity, "foilBaselineCents", parseDollars(e.target.value))}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
          {baselines.length === 0 && <p className="text-sm text-muted-foreground">No rarity baselines set yet -- add one below.</p>}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newRarity">Add rarity</Label>
            {unusedRarities.length > 0 ? (
              <Select value={newRarity} onValueChange={setNewRarity}>
                <SelectTrigger id="newRarity" className="w-48">
                  <SelectValue placeholder="Select a rarity" />
                </SelectTrigger>
                <SelectContent>
                  {unusedRarities.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input id="newRarity" value={newRarity} onChange={(e) => setNewRarity(e.target.value)} placeholder="e.g. mythic" className="w-48" />
            )}
          </div>
          <Button variant="outline" onClick={addRow} disabled={!newRarity.trim()}>
            + Add
          </Button>
        </div>
      </CardContent>
      <CardContent className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
        {saveMessage && <span className="text-sm text-muted-foreground">{saveMessage}</span>}
      </CardContent>
    </Card>
  );
}
