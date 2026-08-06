"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CsvExportControls } from "@/components/csv-export-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export type CatalogCardRow = {
  id: string;
  name: string;
  image_url: string | null;
  rarity: string | null;
  collector_number: string | null;
  sets: { name: string } | null;
};

export function CatalogBrowser({
  game,
  sets,
  cards,
}: {
  game: string;
  sets: { id: string; name: string }[];
  cards: CatalogCardRow[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/inventory/catalog?${params.toString()}`);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(cards.map((c) => c.id)));
  }

  const exportParams: Record<string, string> =
    selected.size > 0
      ? { ids: [...selected].join(",") }
      : {
          game,
          ...(searchParams.get("set") ? { set: searchParams.get("set")! } : {}),
          ...(searchParams.get("q") ? { q: searchParams.get("q")! } : {}),
        };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="game" className="text-xs font-medium text-muted-foreground">
            Game
          </label>
          <select id="game" value={game} onChange={(e) => updateParam("game", e.target.value)} className={selectClassName}>
            <option value="mtg">Magic: The Gathering</option>
            <option value="pokemon">Pokémon</option>
            <option value="yugioh">Yu-Gi-Oh!</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="set" className="text-xs font-medium text-muted-foreground">
            Set
          </label>
          <select
            id="set"
            defaultValue={searchParams.get("set") ?? ""}
            onChange={(e) => updateParam("set", e.target.value)}
            className={selectClassName}
          >
            <option value="">All sets</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
            Search
          </label>
          <Input
            id="q"
            defaultValue={searchParams.get("q") ?? ""}
            onBlur={(e) => updateParam("q", e.target.value)}
            placeholder="Card name"
            className="w-48"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          {cards.length} card(s) shown. {selected.size} selected.
        </span>
        <Button size="sm" variant="outline" onClick={selectAllVisible}>
          Select all visible
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
          Clear selection
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {selected.size > 0
            ? "Exporting selected cards as a blank listing template."
            : "No selection -- exporting all cards matching the current filters as a blank listing template."}
        </p>
        <CsvExportControls baseUrl="/api/catalog/export" extraParams={exportParams} />
      </div>

      <div className="rounded-lg border border-border">
        <Table data-testid="catalog-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Set</TableHead>
              <TableHead>Rarity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cards.map((card) => (
              <TableRow key={card.id} data-testid="catalog-row">
                <TableCell>
                  <input type="checkbox" checked={selected.has(card.id)} onChange={() => toggle(card.id)} />
                </TableCell>
                <TableCell className="font-medium text-foreground">{card.name}</TableCell>
                <TableCell className="text-muted-foreground">{card.sets?.name ?? ""}</TableCell>
                <TableCell className="text-muted-foreground">{card.rarity ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
