"use client";

import { useEffect, useState } from "react";
import { getPriceDetailsForCards, listCardAlternates, type CardAlternate } from "../actions";
import type { BulkRow } from "./bulk-scanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const PRINTINGS = [
  { value: "normal", label: "Normal" },
  { value: "foil", label: "Foil" },
];
const LANGUAGES = ["EN", "JP", "DE", "FR", "IT", "ES", "PT", "Other"];

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function dollars(cents: number | null) {
  return cents === null ? "—" : `$${(cents / 100).toFixed(2)}`;
}

export function CardReviewPanel({
  gameCode,
  row,
  index,
  total,
  onClose,
  onUpdate,
  onNavigate,
}: {
  gameCode: string;
  row: BulkRow;
  index: number;
  total: number;
  onClose: () => void;
  onUpdate: (patch: Partial<BulkRow>) => void;
  onNavigate: (nextIndex: number) => void;
}) {
  const [alternates, setAlternates] = useState<CardAlternate[]>([]);
  const [alternateFilter, setAlternateFilter] = useState("");
  const [selectedAlternate, setSelectedAlternate] = useState<CardAlternate | null>(null);
  const [price, setPrice] = useState<{ marketCents: number | null; lowCents: number | null } | null>(null);

  const matchedCandidate = row.candidates.find((c) => c.id === row.selectedCardId);
  const displayName = selectedAlternate?.name ?? matchedCandidate?.name ?? row.ocrQuery;
  const displaySetName = selectedAlternate?.set_name ?? matchedCandidate?.set_name ?? null;
  const displayImage = selectedAlternate?.image_url ?? matchedCandidate?.image_url ?? null;
  const displayRarity = selectedAlternate?.rarity ?? matchedCandidate?.rarity ?? null;
  const displayNumber = selectedAlternate?.collector_number ?? matchedCandidate?.collector_number ?? null;

  // Reload alternates whenever the matched name changes (a different row is
  // opened, or the operator picks a different ambiguous-match candidate).
  useEffect(() => {
    const name = matchedCandidate?.name ?? (row.status === "matched" ? row.ocrQuery : null);
    setSelectedAlternate(null);
    if (!name) {
      setAlternates([]);
      return;
    }
    let cancelled = false;
    listCardAlternates({ gameCode, name }).then((result) => {
      if (!cancelled && "alternates" in result) setAlternates(result.alternates);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameCode, row.selectedCardId, row.status]);

  // Price for whichever card is currently displayed (the matched candidate,
  // or an alternate the operator switched to).
  useEffect(() => {
    const cardId = selectedAlternate?.id ?? row.selectedCardId;
    if (!cardId) {
      setPrice(null);
      return;
    }
    let cancelled = false;
    getPriceDetailsForCards({ cardIds: [cardId] }).then((result) => {
      if (!cancelled && "prices" in result) setPrice(result.prices[cardId] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedAlternate?.id, row.selectedCardId]);

  function pickAlternate(alt: CardAlternate) {
    setSelectedAlternate(alt);
    onUpdate({ selectedCardId: alt.id });
  }

  function goTo(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= total) return;
    onNavigate(nextIndex);
  }

  function approve() {
    if (!row.selectedCardId) return;
    onUpdate({ reviewState: "approved" });
    if (index + 1 < total) goTo(index + 1);
    else onClose();
  }

  function deny() {
    onUpdate({ reviewState: "denied", excluded: true });
    if (index + 1 < total) goTo(index + 1);
    else onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Fixed shortcuts (not remappable, unlike SortSwift's keybindings modal
    // -- deferred as a later polish item since the mouse-driven flow is
    // fully usable without it).
    if (e.key === "Enter") {
      e.preventDefault();
      approve();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deny();
    } else if (e.key === "ArrowLeft" && e.altKey) {
      e.preventDefault();
      goTo(index - 1);
    } else if (e.key === "ArrowRight" && e.altKey) {
      e.preventDefault();
      goTo(index + 1);
    }
  }

  const filteredAlternates = alternates.filter((a) =>
    alternateFilter.trim() ? `${a.set_name ?? ""} ${a.set_code ?? ""}`.toLowerCase().includes(alternateFilter.toLowerCase()) : true,
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => goTo(index - 1)} disabled={index === 0}>
              ← Prev
            </Button>
            <span className="text-sm text-muted-foreground">
              Card {index + 1} of {total}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => goTo(index + 1)} disabled={index + 1 >= total}>
              Next →
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-2">
            <Label htmlFor="alternate-filter">Same Name Alternates</Label>
            <Input
              id="alternate-filter"
              value={alternateFilter}
              onChange={(e) => setAlternateFilter(e.target.value)}
              placeholder="Filter by set..."
            />
            <ul className="flex flex-col gap-1 overflow-y-auto">
              {filteredAlternates.map((alt) => (
                <li key={alt.id}>
                  <button
                    type="button"
                    onClick={() => pickAlternate(alt)}
                    className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                      (selectedAlternate?.id ?? row.selectedCardId) === alt.id
                        ? "border-primary bg-accent"
                        : "border-border hover:bg-accent/50"
                    }`}
                  >
                    <p className="font-medium text-foreground">{alt.set_name ?? "Unknown set"}</p>
                    <p className="text-muted-foreground">
                      {alt.set_code ?? ""} {alt.collector_number ? `#${alt.collector_number}` : ""} · {alt.rarity ?? ""}
                    </p>
                  </button>
                </li>
              ))}
              {filteredAlternates.length === 0 && <li className="text-xs text-muted-foreground">No alternates found.</li>}
            </ul>
          </div>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">Scanned photo</p>
                {row.imageDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageDataUrl} alt="Scanned card" className="max-h-72 rounded border border-border object-contain" />
                ) : (
                  <div className="flex h-72 w-full items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
                    No image
                  </div>
                )}
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">Reference</p>
                {displayImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImage} alt={displayName} className="max-h-72 rounded border border-border object-contain" />
                ) : (
                  <div className="flex h-72 w-full items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
                    No reference image
                  </div>
                )}
              </div>
            </div>

            <div className="text-center">
              <p className="text-lg font-semibold text-foreground">{displayName || "(unrecognized)"}</p>
              <p className="text-sm text-muted-foreground">
                {displaySetName ?? "—"} {displayNumber ? `(${displayNumber})` : ""} {displayRarity ? `· ${displayRarity}` : ""}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Market: {dollars(price?.marketCents ?? null)} · Low: {dollars(price?.lowCents ?? null)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="review-quantity">Quantity</Label>
                <Input
                  id="review-quantity"
                  type="number"
                  min={1}
                  value={row.quantity}
                  onChange={(e) => onUpdate({ quantity: Math.max(1, Number(e.target.value)) })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="review-condition">Condition</Label>
                <select id="review-condition" value={row.condition} onChange={(e) => onUpdate({ condition: e.target.value })} className={selectClassName}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="review-printing">Printing</Label>
                <select id="review-printing" value={row.printing} onChange={(e) => onUpdate({ printing: e.target.value })} className={selectClassName}>
                  {PRINTINGS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="review-language">Language</Label>
                <select id="review-language" value={row.language} onChange={(e) => onUpdate({ language: e.target.value })} className={selectClassName}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="review-notes">Notes</Label>
              <Input id="review-notes" value={row.notes} onChange={(e) => onUpdate({ notes: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            {row.reviewState === "approved" && <Badge variant="success">Approved</Badge>}
            {row.reviewState === "denied" && <Badge variant="destructive">Denied</Badge>}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="destructive" onClick={deny}>
              Deny
            </Button>
            <Button type="button" onClick={approve} disabled={!row.selectedCardId}>
              Approve
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
