"use client";

import { useEffect, useState } from "react";
import { deleteSetModifier, listSetModifiers, saveSetModifier, searchSetsForConfig, type SearchableSet } from "../../actions";
import type { SetModifier } from "@/types/autopricing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

const FIELDS = [
  { key: "nmModifierPercent", label: "NM Modifier (%)" },
  { key: "lpModifierPercent", label: "LP Modifier (%)" },
  { key: "mpModifierPercent", label: "MP Modifier (%)" },
  { key: "hpModifierPercent", label: "HP Modifier (%)" },
  { key: "dmgModifierPercent", label: "DMG Modifier (%)" },
] as const;

function isFilled(row: SetModifier): boolean {
  return FIELDS.every((f) => row[f.key] != null);
}

function isPartial(row: SetModifier): boolean {
  const filledCount = FIELDS.filter((f) => row[f.key] != null).length;
  return filledCount > 0 && filledCount < FIELDS.length;
}

export function SetModifiersEditor({ configId }: { configId: string }) {
  const [rows, setRows] = useState<SetModifier[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchableSet[]>([]);
  const [hideFilled, setHideFilled] = useState(false);
  const [showPartialOnly, setShowPartialOnly] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    listSetModifiers(configId).then((result) => {
      if (Array.isArray(result)) setRows(result);
      setLoading(false);
    });
  }, [configId]);

  async function handleSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const result = await searchSetsForConfig({ configId, query: value });
    if (Array.isArray(result)) setSearchResults(result.filter((s) => !rows.some((r) => r.setId === s.id)));
  }

  function addSet(set: SearchableSet) {
    setRows((prev) => [
      ...prev,
      {
        id: `pending-${set.id}`,
        setId: set.id,
        setName: set.name,
        nmModifierPercent: null,
        lpModifierPercent: null,
        mpModifierPercent: null,
        hpModifierPercent: null,
        dmgModifierPercent: null,
      },
    ]);
    setSearchResults([]);
    setQuery("");
  }

  function updateField(setId: string, field: (typeof FIELDS)[number]["key"], value: number | null) {
    setRows((prev) => prev.map((r) => (r.setId === setId ? { ...r, [field]: value } : r)));
  }

  async function handleSaveRow(row: SetModifier) {
    setSavingId(row.setId);
    const result = await saveSetModifier({
      configId,
      setId: row.setId,
      nmModifierPercent: row.nmModifierPercent,
      lpModifierPercent: row.lpModifierPercent,
      mpModifierPercent: row.mpModifierPercent,
      hpModifierPercent: row.hpModifierPercent,
      dmgModifierPercent: row.dmgModifierPercent,
    });
    setSavingId(null);
    if (!("error" in result)) setRows((prev) => prev.map((r) => (r.setId === row.setId ? { ...r, id: result.id } : r)));
  }

  async function handleRemoveRow(row: SetModifier) {
    if (!row.id.startsWith("pending-")) {
      await deleteSetModifier({ id: row.id });
    }
    setRows((prev) => prev.filter((r) => r.setId !== row.setId));
  }

  if (loading) return null;

  const visibleRows = rows.filter((row) => {
    if (hideFilled && isFilled(row)) return false;
    if (showPartialOnly && !isPartial(row)) return false;
    return true;
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Set Modifiers</CardTitle>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={hideFilled} onChange={(e) => setHideFilled(e.target.checked)} className="size-4 rounded border-input" />
            Hide Filled
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showPartialOnly} onChange={(e) => setShowPartialOnly(e.target.checked)} className="size-4 rounded border-input" />
            Show Partial
          </label>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Overrides the Condition Modifiers tab for cards in a specific set. Leave a field blank to keep using the global modifier for
          that condition.
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setSearch">Search sets</Label>
          <Input id="setSearch" value={query} onChange={(e) => handleSearch(e.target.value)} placeholder="Filter by set name..." className="w-64" />
          {searchResults.length > 0 && (
            <ul className="max-h-48 w-64 overflow-y-auto rounded-md border border-border bg-card">
              {searchResults.map((s) => (
                <li key={s.id}>
                  <button onClick={() => addSet(s)} className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent">
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {visibleRows.map((row) => (
            <div key={row.setId} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium text-foreground">{row.setName}</p>
                <button aria-label={`Remove ${row.setName}`} onClick={() => handleRemoveRow(row)} className="text-muted-foreground hover:text-destructive">
                  <X className="size-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {FIELDS.map((f) => (
                  <div key={f.key} className="flex flex-col gap-0.5">
                    <Label htmlFor={`${row.setId}-${f.key}`} className="text-xs">
                      {f.label}
                    </Label>
                    <Input
                      id={`${row.setId}-${f.key}`}
                      type="number"
                      value={row[f.key] ?? ""}
                      onChange={(e) => updateField(row.setId, f.key, e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </div>
                ))}
              </div>
              <Button size="sm" className="mt-2" onClick={() => handleSaveRow(row)} disabled={savingId === row.setId}>
                {savingId === row.setId ? "Saving..." : "Save"}
              </Button>
            </div>
          ))}
          {visibleRows.length === 0 && <p className="text-sm text-muted-foreground">No set overrides match the current filters.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
