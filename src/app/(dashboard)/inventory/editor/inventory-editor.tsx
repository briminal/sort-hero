"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { saveInventoryEdits } from "./actions";
import type { UpdateInventoryItemInput } from "@/types/inventory";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const cellInputClassName =
  "h-8 w-full rounded border border-input bg-background px-1.5 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const toolbarSelectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export type EditorRow = {
  id: string;
  quantity: number;
  condition: string;
  price_cents: number | null;
  cost_cents: number | null;
  notes: string | null;
  status: string;
  updated_at: string;
  cards: { name: string; sets: { name: string } | null };
};

type EditableField = "quantity" | "condition" | "price_cents" | "cost_cents" | "notes";
const EDITABLE_FIELDS: EditableField[] = ["quantity", "condition", "price_cents", "cost_cents", "notes"];
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];

// Matches the column order defined below (select, card, set, quantity,
// condition, price, cost, notes) -- shared between header and body rows so
// every row's columns line up exactly.
const COLUMN_WIDTHS = [32, 220, 160, 90, 90, 90, 90, 220];

type HistoryEntry = { id: string; field: EditableField; previousValue: string | number | null };

function toCents(dollars: string): number | null {
  if (dollars.trim() === "") return null;
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const columnHelper = createColumnHelper<EditorRow>();

export function InventoryEditor({ items }: { items: EditorRow[] }) {
  const [rows, setRows] = useState<EditorRow[]>(items);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [repriceMode, setRepriceMode] = useState<"percent" | "fixed">("percent");
  const [repriceValue, setRepriceValue] = useState("");
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);
  const originalById = useMemo(() => new Map(items.map((r) => [r.id, r])), [items]);

  // Multiple field updates can happen synchronously within one event (a
  // paste spanning several cells calls updateField many times in a single
  // handler). Reading from the `rows` state variable in that loop would see
  // the same pre-paste snapshot every time -- each call's `{...row, field}`
  // would overwrite the previous call's change instead of compounding. A
  // ref updated synchronously alongside every write avoids that.
  const rowsRef = useRef(items);

  // Dirty is derived by comparing against the original value, not just
  // "was ever touched" -- otherwise undoing an edit back to its original
  // value would still leave it marked dirty and get needlessly re-sent
  // (or worse, misleadingly counted) on Save.
  function recomputeDirty(id: string, row: EditorRow) {
    const original = originalById.get(id);
    const isDirty = !original || EDITABLE_FIELDS.some((f) => row[f] !== original[f]);
    setDirtyIds((prev) => {
      const next = new Set(prev);
      if (isDirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function updateField(id: string, field: EditableField, value: string | number | null) {
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row || row[field] === value) return;
    setHistory((h) => [...h, { id, field, previousValue: row[field] }]);
    const updatedRow = { ...row, [field]: value } as EditorRow;
    const nextRows = rowsRef.current.map((r) => (r.id === id ? updatedRow : r));
    rowsRef.current = nextRows;
    setRows(nextRows);
    recomputeDirty(id, updatedRow);
  }

  function handleUndo() {
    const last = history[history.length - 1];
    if (!last) return;
    const row = rowsRef.current.find((r) => r.id === last.id);
    if (!row) return;
    const updatedRow = { ...row, [last.field]: last.previousValue } as EditorRow;
    const nextRows = rowsRef.current.map((r) => (r.id === last.id ? updatedRow : r));
    rowsRef.current = nextRows;
    setRows(nextRows);
    recomputeDirty(last.id, updatedRow);
    setHistory((h) => h.slice(0, -1));
  }

  function handlePaste(e: React.ClipboardEvent, rowIndex: number, field: EditableField) {
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    const parsed = Papa.parse<string[]>(text, { delimiter: "\t" }).data;
    const startFieldIndex = EDITABLE_FIELDS.indexOf(field);

    parsed.forEach((line, r) => {
      const targetRow = rowsRef.current[rowIndex + r];
      if (!targetRow) return;
      line.forEach((cell, c) => {
        const targetField = EDITABLE_FIELDS[startFieldIndex + c];
        if (!targetField) return;
        const value =
          targetField === "quantity"
            ? Number(cell) || 0
            : targetField === "price_cents" || targetField === "cost_cents"
              ? toCents(cell)
              : targetField === "condition"
                ? CONDITIONS.includes(cell.trim().toUpperCase())
                  ? cell.trim().toUpperCase()
                  : targetRow.condition
                : cell;
        updateField(targetRow.id, targetField, value);
      });
    });
  }

  function applyBulkReprice() {
    const value = Number(repriceValue);
    if (!Number.isFinite(value) || selected.size === 0) return;

    for (const id of selected) {
      const row = rowsRef.current.find((r) => r.id === id);
      if (!row || row.price_cents === null) continue;
      const newPrice =
        repriceMode === "percent"
          ? Math.round(row.price_cents * (1 + value / 100))
          : row.price_cents + Math.round(value * 100);
      updateField(id, "price_cents", Math.max(0, newPrice));
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);

    const edits: UpdateInventoryItemInput[] = [...dirtyIds].map((id) => {
      const row = rows.find((r) => r.id === id)!;
      return {
        id: row.id,
        quantity: row.quantity,
        condition: row.condition as UpdateInventoryItemInput["condition"],
        priceCents: row.price_cents,
        costCents: row.cost_cents,
        notes: row.notes,
        expectedUpdatedAt: originalById.get(id)?.updated_at ?? null,
      };
    });

    const result = await saveInventoryEdits({ edits });
    setSaving(false);

    if ("error" in result) {
      setSaveResult(`Error: ${result.error}`);
      return;
    }

    setSaveResult(
      `Saved ${result.updated} item(s)` +
        (result.failed.length > 0 ? `, ${result.failed.length} failed` : ""),
    );
    if (result.failed.length === 0) {
      setDirtyIds(new Set());
      setHistory([]);
    } else {
      setDirtyIds(new Set(result.failed.map((f) => f.id)));
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: "",
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selected.has(row.original.id)}
            onChange={() =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(row.original.id)) next.delete(row.original.id);
                else next.add(row.original.id);
                return next;
              })
            }
          />
        ),
      }),
      columnHelper.accessor((r) => r.cards.name, {
        id: "card_name",
        header: "Card",
        cell: (info) => <span className="text-foreground">{info.getValue()}</span>,
      }),
      columnHelper.accessor((r) => r.cards.sets?.name ?? "", {
        id: "set_name",
        header: "Set",
        cell: (info) => <span className="text-muted-foreground">{info.getValue()}</span>,
      }),
      columnHelper.accessor("quantity", {
        header: "Quantity",
        cell: ({ row }) => (
          <input
            type="number"
            min={0}
            value={row.original.quantity}
            onPaste={(e) => handlePaste(e, row.index, "quantity")}
            onChange={(e) => updateField(row.original.id, "quantity", Number(e.target.value))}
            aria-label={`Quantity for ${row.original.cards.name}`}
            className={cellInputClassName}
          />
        ),
      }),
      columnHelper.accessor("condition", {
        header: "Condition",
        cell: ({ row }) => (
          <select
            value={row.original.condition}
            onChange={(e) => updateField(row.original.id, "condition", e.target.value)}
            aria-label={`Condition for ${row.original.cards.name}`}
            className={cellInputClassName}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ),
      }),
      columnHelper.accessor("price_cents", {
        header: "Price",
        cell: ({ row }) => (
          <input
            type="number"
            step="0.01"
            min={0}
            value={row.original.price_cents !== null ? (row.original.price_cents / 100).toFixed(2) : ""}
            onPaste={(e) => handlePaste(e, row.index, "price_cents")}
            onChange={(e) => updateField(row.original.id, "price_cents", toCents(e.target.value))}
            aria-label={`Price for ${row.original.cards.name}`}
            className={cellInputClassName}
          />
        ),
      }),
      columnHelper.accessor("cost_cents", {
        header: "Cost",
        cell: ({ row }) => (
          <input
            type="number"
            step="0.01"
            min={0}
            value={row.original.cost_cents !== null ? (row.original.cost_cents / 100).toFixed(2) : ""}
            onPaste={(e) => handlePaste(e, row.index, "cost_cents")}
            onChange={(e) => updateField(row.original.id, "cost_cents", toCents(e.target.value))}
            aria-label={`Cost for ${row.original.cards.name}`}
            className={cellInputClassName}
          />
        ),
      }),
      columnHelper.accessor("notes", {
        header: "Notes",
        cell: ({ row }) => (
          <input
            type="text"
            value={row.original.notes ?? ""}
            onPaste={(e) => handlePaste(e, row.index, "notes")}
            onChange={(e) => updateField(row.original.id, "notes", e.target.value)}
            aria-label={`Notes for ${row.original.cards.name}`}
            className={cellInputClassName}
          />
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, rows],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const tableRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Button size="sm" variant="outline" onClick={handleUndo} disabled={history.length === 0}>
          Undo
        </Button>
        <select
          value={repriceMode}
          onChange={(e) => setRepriceMode(e.target.value as "percent" | "fixed")}
          className={toolbarSelectClassName}
        >
          <option value="percent">% change</option>
          <option value="fixed">$ change</option>
        </select>
        <input
          type="number"
          value={repriceValue}
          onChange={(e) => setRepriceValue(e.target.value)}
          placeholder="e.g. 10 or -10"
          aria-label="Reprice value"
          className="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button size="sm" variant="outline" onClick={applyBulkReprice} disabled={selected.size === 0}>
          Apply reprice to {selected.size} selected
        </Button>
        <Button size="sm" onClick={handleSave} disabled={dirtyIds.size === 0 || saving}>
          {saving ? "Saving..." : `Save changes (${dirtyIds.size})`}
        </Button>
        {saveResult && (
          <span data-testid="save-result" className="text-sm text-muted-foreground">
            {saveResult}
          </span>
        )}
      </div>

      {/* Real <table> semantics don't work for virtualized rows -- each
          absolutely-positioned <tr> would compute its own independent
          column widths (auto/fixed table layout is per-table, and each
          row here is its own layout box), misaligning columns across rows
          and letting adjacent rows' inputs intercept clicks. Fixed-width
          flex rows, sharing one column-width array between header and
          body, avoid that entirely. */}
      <div
        ref={parentRef}
        style={{ height: 600, overflow: "auto" }}
        data-testid="editor-scroll"
        className="rounded-lg border border-border"
      >
        {table.getHeaderGroups().map((hg) => (
          <div key={hg.id} style={{ display: "flex" }} className="sticky top-0 z-10 border-b border-border bg-card">
            {hg.headers.map((header) => (
              <div
                key={header.id}
                style={{ width: COLUMN_WIDTHS[header.column.getIndex()] }}
                className="px-1.5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            ))}
          </div>
        ))}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = tableRows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={row.id}
                data-testid="editor-row"
                data-dirty={dirtyIds.has(row.original.id)}
                style={{
                  display: "flex",
                  width: "100%",
                  position: "absolute",
                  top: 0,
                  left: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={cn(
                  "items-center border-b border-border",
                  dirtyIds.has(row.original.id) && "bg-accent/40",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <div key={cell.id} style={{ width: COLUMN_WIDTHS[cell.column.getIndex()] }} className="px-1.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
