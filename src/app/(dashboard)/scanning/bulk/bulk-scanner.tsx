"use client";

import { useRef, useState } from "react";
import { extractText, pickLikelyCardName } from "@/lib/recognition/ocr";
import { AMBIGUOUS_SCORE_GAP, MATCH_THRESHOLD, type CardCandidate } from "@/lib/recognition/match";
import {
  confirmBulkScan,
  getPriceDetailsForCards,
  getSetsForGame,
  requestUploadUrl,
  searchCards,
  updateHighValueThreshold,
  type SetOption,
} from "../actions";
import type { ActiveGame } from "@/lib/games";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CardReviewPanel } from "./card-review-panel";
import { StatisticsPanel } from "./statistics-panel";
import { ExportPanel } from "./export-panel";
import { PrintPanel } from "./print-panel";

type RowStatus = "processing" | "matched" | "ambiguous" | "unmatched";
export type ReviewState = "pending" | "approved" | "denied";

export type BulkRow = {
  fileName: string;
  imageDataUrl: string;
  status: RowStatus;
  ocrQuery: string;
  candidates: CardCandidate[];
  selectedCardId: string | null;
  confidence: number | null;
  quantity: number;
  condition: string;
  printing: string;
  language: string;
  notes: string;
  costCents: number | null;
  marketPriceCents: number | null;
  lowPriceCents: number | null;
  excluded: boolean;
  reviewState: ReviewState;
};

export function priceCentsFor(row: BulkRow, basis: "market" | "low"): number | null {
  return basis === "low" ? row.lowPriceCents : row.marketPriceCents;
}

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const PRINTINGS = [
  { value: "normal", label: "Normal" },
  { value: "foil", label: "Foil" },
];
const LANGUAGES = ["EN", "JP", "DE", "FR", "IT", "ES", "PT", "Other"];

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function dataUrlToBlob(dataUrl: string): Blob {
  const [header = "", base64 = ""] = dataUrl.split(",");
  const mime = header.match(/data:(.*);base64/)?.[1] ?? "image/jpeg";
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Rotates a data URL image 180 degrees via canvas -- used to give
 * upside-down-photographed cards a second OCR pass, since Tesseract reads
 * inverted text as gibberish rather than failing loudly. */
function rotate180(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not supported"));
        return;
      }
      ctx.translate(canvas.width, canvas.height);
      ctx.rotate(Math.PI);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => reject(new Error("Could not load image for rotation"));
    img.src = dataUrl;
  });
}

type OcrMatchResult = { candidates: CardCandidate[]; query: string };

async function ocrAndMatch(imageDataUrl: string, gameCode: string, setId: string | null): Promise<OcrMatchResult> {
  const text = await extractText(imageDataUrl);
  const query = pickLikelyCardName(text);
  if (query.length < 2) return { candidates: [], query };

  const result = await searchCards({ gameCode, query, setId });
  return { candidates: "candidates" in result ? result.candidates : [], query };
}

export function BulkScanner({
  initialThresholdCents,
  games,
}: {
  initialThresholdCents: number;
  games: ActiveGame[];
}) {
  const [gameCode, setGameCode] = useState<string>(games[0]?.code ?? "mtg");
  const [sets, setSets] = useState<SetOption[]>([]);
  const [setId, setSetId] = useState<string>("");
  const [defaultCondition, setDefaultCondition] = useState("NM");
  const [defaultPrinting, setDefaultPrinting] = useState("normal");
  const [defaultLanguage, setDefaultLanguage] = useState("EN");
  const [defaultComment, setDefaultComment] = useState("");
  const [costMode, setCostMode] = useState<"percentage" | "fixed">("percentage");
  const [costValue, setCostValue] = useState("40");
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<string | null>(null);
  const [thresholdCents, setThresholdCents] = useState(initialThresholdCents);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [priceBasis, setPriceBasis] = useState<"market" | "low">("market");
  const [confidenceThresholdPct, setConfidenceThresholdPct] = useState(30);
  // Off by default -- trying both orientations doubles the OCR time per
  // image, worth paying for a batch of shuffled/misoriented photos, not
  // worth paying unconditionally on every batch.
  const [upsideDownDetection, setUpsideDownDetection] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Lets staff keep feeding in new photos (scan) while already-processed
  // cards are being reviewed/approved/pushed to inventory (intake) --
  // dropping a new batch while one is still OCR-ing queues it instead of
  // starting a second concurrent Tesseract run (worker-pool contention) or
  // wiping the in-progress queue.
  const isProcessingRef = useRef(false);
  const queuedFilesRef = useRef<File[]>([]);

  function costCentsFor(marketPriceCents: number | null): number | null {
    if (marketPriceCents === null) return null;
    const value = Number(costValue);
    if (!Number.isFinite(value)) return null;
    return costMode === "percentage" ? Math.round(marketPriceCents * (value / 100)) : Math.round(value * 100);
  }

  async function loadSets(nextGameCode: string) {
    setSetId("");
    const result = await getSetsForGame({ gameCode: nextGameCode });
    setSets("sets" in result ? result.sets : []);
  }

  async function processFiles(fileArray: File[]) {
    if (fileArray.length === 0) return;
    setError(null);
    setConfirmResult(null);

    // Already scanning a batch -- queue these instead of racing a second
    // Tesseract loop or wiping the in-progress rows. The active loop below
    // drains the queue once its current batch finishes.
    if (isProcessingRef.current) {
      queuedFilesRef.current.push(...fileArray);
      setProgress((prev) => ({ done: prev.done, total: prev.total + fileArray.length }));
      return;
    }

    isProcessingRef.current = true;
    setProcessing(true);
    let remaining = fileArray;
    let doneSoFar = 0;
    setProgress({ done: 0, total: remaining.length });

    while (remaining.length > 0) {
      const processedRows: BulkRow[] = [];

      // One at a time -- Tesseract.js runs a real OCR pass per image (a few
      // seconds each), so this is deliberately sequential rather than
      // Promise.all-ing the whole batch, both to avoid saturating the
      // browser's worker pool and so results can stream into the review list
      // incrementally instead of the page looking frozen for a big batch.
      for (let i = 0; i < remaining.length; i++) {
        const file = remaining[i]!;
        let row: BulkRow;
        try {
          const imageDataUrl = await readFileAsDataUrl(file);
          let candidates: CardCandidate[] = [];
          let usedImageDataUrl = imageDataUrl;

          const upright = await ocrAndMatch(imageDataUrl, gameCode, setId || null);
          candidates = upright.candidates;
          let ocrQuery = upright.query;

          // If the upright pass found nothing (or a weak match) and
          // upside-down detection is on, try a 180-rotated pass and keep
          // whichever orientation actually matched -- Tesseract reads
          // inverted card text as gibberish rather than failing loudly, so
          // there's no cheaper signal than just trying both.
          if (upsideDownDetection && (candidates[0]?.score ?? 0) < MATCH_THRESHOLD) {
            const rotatedDataUrl = await rotate180(imageDataUrl);
            const rotated = await ocrAndMatch(rotatedDataUrl, gameCode, setId || null);
            if ((rotated.candidates[0]?.score ?? 0) > (candidates[0]?.score ?? 0)) {
              candidates = rotated.candidates;
              usedImageDataUrl = rotatedDataUrl;
              ocrQuery = rotated.query;
            }
          }

          const top = candidates[0];
          let status: RowStatus = "unmatched";
          let selectedCardId: string | null = null;

          if (top && top.score >= MATCH_THRESHOLD) {
            const second = candidates[1];
            const clearlyBest = !second || top.score - second.score > AMBIGUOUS_SCORE_GAP;
            status = clearlyBest ? "matched" : "ambiguous";
            selectedCardId = clearlyBest ? top.id : null;
          }

          row = {
            fileName: file.name,
            imageDataUrl: usedImageDataUrl,
            status,
            ocrQuery,
            candidates,
            selectedCardId,
            confidence: top ? top.score : null,
            quantity: 1,
            condition: defaultCondition,
            printing: defaultPrinting,
            language: defaultLanguage,
            notes: defaultComment,
            costCents: null,
            marketPriceCents: null,
            lowPriceCents: null,
            excluded: false,
            reviewState: "pending",
          };
        } catch (err) {
          row = {
            fileName: file.name,
            imageDataUrl: "",
            status: "unmatched",
            ocrQuery: "",
            candidates: [],
            selectedCardId: null,
            confidence: null,
            quantity: 1,
            condition: defaultCondition,
            printing: defaultPrinting,
            language: defaultLanguage,
            notes: defaultComment,
            costCents: null,
            marketPriceCents: null,
            lowPriceCents: null,
            excluded: false,
            reviewState: "pending",
          };
          console.error(`Failed to process ${file.name}`, err);
        }

        processedRows.push(row);
        doneSoFar++;
        setProgress((prev) => ({ done: doneSoFar, total: prev.total }));
        // Append, never replace -- a card dropped while an earlier batch is
        // still under review (or mid-push) must not wipe it out.
        setRows((prev) => [...prev, row]);
      }

      // One batched price lookup for every matched/ambiguous card in this
      // chunk instead of one query per row.
      const cardIds = [...new Set(processedRows.map((r) => r.selectedCardId).filter((id): id is string => !!id))];
      if (cardIds.length > 0) {
        const priceResult = await getPriceDetailsForCards({ cardIds });
        if ("prices" in priceResult) {
          const chunkRows = new Set(processedRows);
          setRows((prev) =>
            prev.map((existing) => {
              if (!chunkRows.has(existing)) return existing;
              const detail = existing.selectedCardId ? priceResult.prices[existing.selectedCardId] : undefined;
              return {
                ...existing,
                marketPriceCents: detail?.marketCents ?? null,
                lowPriceCents: detail?.lowCents ?? null,
                costCents: costCentsFor(detail?.marketCents ?? null),
              };
            }),
          );
        }
      }

      // Drain anything dropped while this chunk was processing.
      remaining = queuedFilesRef.current;
      queuedFilesRef.current = [];
    }

    isProcessingRef.current = false;
    setProcessing(false);
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files) return;
    await processFiles(Array.from(files));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    processFiles(files);
  }

  function updateRow(index: number, patch: Partial<BulkRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSaveThreshold() {
    setSavingThreshold(true);
    const result = await updateHighValueThreshold({ thresholdCents });
    setSavingThreshold(false);
    if ("error" in result) setError(result.error);
  }

  /** Bulk-approves every row that has a resolved match and hasn't already
   * been explicitly denied -- a low-friction path for shops that don't want
   * to step through the per-card Review panel for every scan. */
  function approveAllMatched() {
    setRows((prev) =>
      prev.map((r) => (r.selectedCardId && r.reviewState === "pending" ? { ...r, reviewState: "approved" } : r)),
    );
  }

  async function handlePushToInventory() {
    setError(null);
    setConfirmResult(null);
    setConfirming(true);

    // Only explicitly approved rows are pushed -- denied/pending rows never
    // reach inventory, matching the review workflow's Approve/Deny gate
    // instead of "everything not manually removed."
    const keptRows = rows.filter((r) => !r.excluded && r.reviewState === "approved" && r.selectedCardId);

    try {
      const items: {
        cardId: string;
        imageKey: string | null;
        quantity: number;
        condition: string;
        printing: string;
        language: string;
        notes: string | null;
        costCents: number | null;
      }[] = [];

      for (const row of keptRows) {
        let imageKey: string | null = null;
        const blob = dataUrlToBlob(row.imageDataUrl);
        const uploadResult = await requestUploadUrl(blob.size);
        if ("uploadUrl" in uploadResult) {
          try {
            await fetch(uploadResult.uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": "image/jpeg" },
              body: blob,
            });
            imageKey = uploadResult.key;
          } catch {
            // Upload failing doesn't block confirming -- same tolerance as
            // the single-card flow.
          }
        }

        items.push({
          cardId: row.selectedCardId!,
          imageKey,
          quantity: row.quantity,
          condition: row.condition,
          printing: row.printing,
          language: row.language,
          notes: row.notes.trim() || null,
          costCents: row.costCents,
        });
      }

      if (items.length === 0) {
        setError("No approved cards to push -- approve rows in the Review panel first, or use \"Approve all matched.\"");
        setConfirming(false);
        return;
      }

      const result = await confirmBulkScan({ items });
      if ("error" in result) {
        setError(result.error);
      } else {
        setConfirmResult(`Added ${result.inserted} card(s) to staged inventory.`);
        setRows([]);
      }
    } finally {
      setConfirming(false);
    }
  }

  function isHighValueRow(row: BulkRow): boolean {
    const price = priceCentsFor(row, priceBasis);
    return price !== null && price >= thresholdCents;
  }

  const stats = {
    total: rows.length,
    matched: rows.filter((r) => r.status === "matched").length,
    ambiguous: rows.filter((r) => r.status === "ambiguous").length,
    unmatched: rows.filter((r) => r.status === "unmatched").length,
    highValue: rows.filter(isHighValueRow).length,
    approved: rows.filter((r) => r.reviewState === "approved").length,
    denied: rows.filter((r) => r.reviewState === "denied").length,
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            dragActive ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <p className="text-sm font-medium text-foreground">Drag &amp; drop card photos here, or click to select files</p>
          <p className="text-xs text-muted-foreground">Only *.jpeg and *.png images will be accepted</p>
        </div>

        {processing && (
          <p className="text-sm text-muted-foreground">
            Processing {progress.done} / {progress.total}...
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {confirmResult && (
          <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            {confirmResult}
          </p>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-card p-3 text-sm">
              <span>Total: {stats.total}</span>
              <span className="text-success">Matched: {stats.matched}</span>
              <span className="text-primary">Ambiguous: {stats.ambiguous}</span>
              <span className="text-destructive">Unmatched: {stats.unmatched}</span>
              {stats.highValue > 0 && <span className="font-semibold text-primary">High value: {stats.highValue}</span>}
              <span className="text-success">Approved: {stats.approved}</span>
              <span className="text-destructive">Denied: {stats.denied}</span>
            </div>

            <div className="flex flex-col gap-2">
              {rows.map((row, index) => {
                const selected = row.candidates.find((c) => c.id === row.selectedCardId);
                return (
                  <div
                    key={`${row.fileName}-${index}`}
                    data-testid="bulk-row"
                    data-status={row.status}
                    className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-3"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={row.imageDataUrl}
                      alt={`Scanned ${row.fileName}`}
                      className="h-24 w-auto rounded border border-border object-cover"
                    />

                    {selected?.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selected.image_url}
                        alt={selected.name}
                        className="h-24 w-auto rounded border border-border object-cover"
                      />
                    ) : (
                      <div className="flex h-24 w-16 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
                        No match
                      </div>
                    )}

                    <div className="min-w-40 flex-1">
                      <p className="text-sm font-medium text-foreground">{selected?.name ?? row.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {selected?.set_name ?? "—"}
                        {selected?.collector_number ? ` (${selected.collector_number})` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">Original file: {row.fileName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {row.confidence !== null && (
                          <Badge variant={row.confidence >= MATCH_THRESHOLD ? "secondary" : "destructive"}>
                            Confidence {Math.round(row.confidence * 100)}%
                          </Badge>
                        )}
                        {isHighValueRow(row) && <Badge>High value</Badge>}
                        {row.confidence !== null && row.confidence * 100 < confidenceThresholdPct && (
                          <Badge variant="destructive">Low confidence</Badge>
                        )}
                        {row.reviewState === "approved" && <Badge variant="success">Approved</Badge>}
                        {row.reviewState === "denied" && <Badge variant="destructive">Denied</Badge>}
                      </div>
                    </div>

                    {(row.status === "ambiguous" || row.status === "unmatched") && (
                      <select
                        value={row.selectedCardId ?? ""}
                        onChange={(e) => updateRow(index, { selectedCardId: e.target.value || null })}
                        aria-label={`Choose match for ${row.fileName}`}
                        className={selectClassName}
                      >
                        <option value="">Select a match...</option>
                        {row.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} {c.set_name ? `(${c.set_name})` : ""}
                          </option>
                        ))}
                      </select>
                    )}

                    <Input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => updateRow(index, { quantity: Math.max(1, Number(e.target.value)) })}
                      aria-label={`Quantity for ${row.fileName}`}
                      className="h-9 w-16"
                    />

                    <select
                      value={row.condition}
                      onChange={(e) => updateRow(index, { condition: e.target.value })}
                      aria-label={`Condition for ${row.fileName}`}
                      className={selectClassName}
                    >
                      {CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>

                    <select
                      value={row.printing}
                      onChange={(e) => updateRow(index, { printing: e.target.value })}
                      aria-label={`Printing for ${row.fileName}`}
                      className={selectClassName}
                    >
                      {PRINTINGS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={row.language}
                      onChange={(e) => updateRow(index, { language: e.target.value })}
                      aria-label={`Language for ${row.fileName}`}
                      className={selectClassName}
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>

                    <Input
                      type="text"
                      value={row.notes}
                      onChange={(e) => updateRow(index, { notes: e.target.value })}
                      placeholder="Notes"
                      aria-label={`Notes for ${row.fileName}`}
                      className="h-9 w-32"
                    />

                    <Button type="button" variant="outline" size="sm" onClick={() => setReviewIndex(index)}>
                      Review
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(index)} aria-label={`Remove ${row.fileName}`}>
                      Remove
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={approveAllMatched}>
                Approve all matched
              </Button>
              <Button type="button" onClick={handlePushToInventory} disabled={confirming}>
                {confirming
                  ? "Pushing..."
                  : `Push to Inventory (${rows.filter((r) => !r.excluded && r.reviewState === "approved" && r.selectedCardId).length})`}
              </Button>
            </div>
          </>
        )}
      </div>

      {reviewIndex !== null && rows[reviewIndex] && (
        <CardReviewPanel
          gameCode={gameCode}
          row={rows[reviewIndex]}
          index={reviewIndex}
          total={rows.length}
          onClose={() => setReviewIndex(null)}
          onUpdate={(patch) => updateRow(reviewIndex, patch)}
          onNavigate={(nextIndex) => setReviewIndex(nextIndex)}
        />
      )}

      <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Recognition Configuration</CardTitle>
          <p className="text-xs text-muted-foreground">Set before identifying</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-game">Game (required)</Label>
            <select
              id="bulk-game"
              value={gameCode}
              onChange={(e) => {
                setGameCode(e.target.value);
                loadSets(e.target.value);
              }}
              className={selectClassName}
            >
              {games.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-set">Expansion (optional)</Label>
            <select id="bulk-set" value={setId} onChange={(e) => setSetId(e.target.value)} className={selectClassName}>
              <option value="">All expansions</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-condition">Condition</Label>
              <select id="bulk-condition" value={defaultCondition} onChange={(e) => setDefaultCondition(e.target.value)} className={selectClassName}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-language">Language</Label>
              <select id="bulk-language" value={defaultLanguage} onChange={(e) => setDefaultLanguage(e.target.value)} className={selectClassName}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-printing">Printing</Label>
              <select id="bulk-printing" value={defaultPrinting} onChange={(e) => setDefaultPrinting(e.target.value)} className={selectClassName}>
                {PRINTINGS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-comment">Comment</Label>
            <Input id="bulk-comment" value={defaultComment} onChange={(e) => setDefaultComment(e.target.value)} placeholder="Default note for new rows" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-cost-mode">Cost mode</Label>
              <select
                id="bulk-cost-mode"
                value={costMode}
                onChange={(e) => setCostMode(e.target.value as "percentage" | "fixed")}
                className={selectClassName}
              >
                <option value="percentage">Percentage of market price</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-cost-value">{costMode === "percentage" ? "Cost %" : "Cost ($)"}</Label>
              <Input
                id="bulk-cost-value"
                type="number"
                min={0}
                step={costMode === "percentage" ? 1 : 0.01}
                value={costValue}
                onChange={(e) => setCostValue(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={upsideDownDetection}
              onChange={(e) => setUpsideDownDetection(e.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            Upside-down detection
          </label>
        </CardContent>
      </Card>

      <StatisticsPanel
        rows={rows}
        priceBasis={priceBasis}
        onPriceBasisChange={setPriceBasis}
        thresholdCents={thresholdCents}
        onThresholdCentsChange={setThresholdCents}
        onSaveThreshold={handleSaveThreshold}
        savingThreshold={savingThreshold}
        confidenceThresholdPct={confidenceThresholdPct}
        onConfidenceThresholdPctChange={setConfidenceThresholdPct}
      />

      <ExportPanel rows={rows} priceBasis={priceBasis} thresholdCents={thresholdCents} />
      <PrintPanel rows={rows} priceBasis={priceBasis} />
      </div>
    </div>
  );
}
