"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  bulkConfirmItems,
  bulkDeleteItems,
  deleteInventoryItem,
  updateInventoryItem,
} from "./actions";
import { CsvExportControls } from "@/components/csv-export-controls";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type InventoryItemRow = {
  id: string;
  quantity: number;
  condition: string;
  price_cents: number | null;
  notes: string | null;
  status: string;
  scanned_image_url: string | null;
  created_at: string;
  updated_at: string;
  cards: {
    id: string;
    name: string;
    image_url: string | null;
    rarity: string | null;
    collector_number: string | null;
    game_id: string;
    sets: { name: string } | null;
    games: { code: string } | null;
  };
};

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function InventoryList({
  items,
  isOwner,
}: {
  items: InventoryItemRow[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function updateSearchParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/inventory?${params.toString()}`);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFieldChange(
    id: string,
    field: "quantity" | "condition" | "priceCents" | "notes",
    value: string,
    expectedUpdatedAt: string,
  ) {
    setError(null);
    const patch: Record<string, unknown> = { id, expectedUpdatedAt };

    if (field === "quantity") patch.quantity = Number(value);
    else if (field === "priceCents") patch.priceCents = value === "" ? null : Math.round(Number(value) * 100);
    else patch[field] = value;

    const result = await updateInventoryItem(patch as Parameters<typeof updateInventoryItem>[0]);
    if ("error" in result) setError(result.error);
    else startTransition(() => router.refresh());
  }

  async function handleDelete(id: string) {
    setError(null);
    const result = await deleteInventoryItem({ id });
    if ("error" in result) setError(result.error);
    else startTransition(() => router.refresh());
  }

  async function handleBulkConfirm() {
    setError(null);
    const result = await bulkConfirmItems({ ids: [...selected] });
    if ("error" in result) setError(result.error);
    else {
      setSelected(new Set());
      startTransition(() => router.refresh());
    }
  }

  async function handleBulkDelete() {
    setError(null);
    const result = await bulkDeleteItems({ ids: [...selected] });
    if ("error" in result) setError(result.error);
    else {
      setSelected(new Set());
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
            Search
          </label>
          <Input
            id="q"
            className="w-48"
            defaultValue={searchParams.get("q") ?? ""}
            onBlur={(e) => updateSearchParam("q", e.target.value)}
            placeholder="Card name"
          />
        </div>

        <div className="grid gap-1">
          <label htmlFor="status" className="text-xs font-medium text-muted-foreground">
            Status
          </label>
          <select
            id="status"
            className={selectClassName}
            defaultValue={searchParams.get("status") ?? ""}
            onChange={(e) => updateSearchParam("status", e.target.value)}
          >
            <option value="">All</option>
            <option value="staged">Staged</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </div>

        <div className="grid gap-1">
          <label htmlFor="game" className="text-xs font-medium text-muted-foreground">
            Game
          </label>
          <select
            id="game"
            className={selectClassName}
            defaultValue={searchParams.get("game") ?? ""}
            onChange={(e) => updateSearchParam("game", e.target.value)}
          >
            <option value="">All</option>
            <option value="mtg">Magic: The Gathering</option>
            <option value="pokemon">Pokémon</option>
            <option value="yugioh">Yu-Gi-Oh!</option>
          </select>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/inventory/import">Import CSV</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/inventory/catalog">Browse Catalog</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/inventory/editor">Open Editor</Link>
          </Button>
          <CsvExportControls
            baseUrl="/api/inventory/export"
            extraParams={Object.fromEntries(searchParams.entries())}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
          <span className="text-sm text-muted-foreground">{selected.size} selected</span>
          <Button size="sm" onClick={handleBulkConfirm}>
            Confirm selected
          </Button>
          {isOwner && (
            <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
              Delete selected
            </Button>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border">
        <Table data-testid="inventory-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Card</TableHead>
              <TableHead>Set</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Status</TableHead>
              {isOwner && <TableHead className="w-8"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-testid="inventory-row">
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                  />
                </TableCell>
                <TableCell className="font-medium">{item.cards.name}</TableCell>
                <TableCell className="text-muted-foreground">{item.cards.sets?.name ?? ""}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    className="h-8 w-16"
                    defaultValue={item.quantity}
                    onBlur={(e) => handleFieldChange(item.id, "quantity", e.target.value, item.updated_at)}
                    aria-label={`Quantity for ${item.cards.name}`}
                  />
                </TableCell>
                <TableCell>
                  <select
                    className={cn(selectClassName, "h-8")}
                    defaultValue={item.condition}
                    onChange={(e) => handleFieldChange(item.id, "condition", e.target.value, item.updated_at)}
                    aria-label={`Condition for ${item.cards.name}`}
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    className="h-8 w-24"
                    defaultValue={item.price_cents !== null ? (item.price_cents / 100).toFixed(2) : ""}
                    onBlur={(e) => handleFieldChange(item.id, "priceCents", e.target.value, item.updated_at)}
                    aria-label={`Price for ${item.cards.name}`}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="text"
                    className="h-8 w-40"
                    defaultValue={item.notes ?? ""}
                    onBlur={(e) => handleFieldChange(item.id, "notes", e.target.value, item.updated_at)}
                    aria-label={`Notes for ${item.cards.name}`}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant={item.status === "confirmed" ? "success" : "secondary"}>{item.status}</Badge>
                </TableCell>
                {isOwner && (
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} aria-label={`Delete ${item.cards.name}`}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {items.length === 0 && <p className="text-sm text-muted-foreground">No inventory items found.</p>}
    </div>
  );
}
