"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { commitImportRows, previewImportRows, type PreviewedRow } from "./actions";
import { getActiveGames } from "../../../games-actions";
import type { ActiveGame } from "@/lib/games";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function previewStatusVariant(status: string): "success" | "destructive" | "secondary" {
  if (status === "matched") return "success";
  if (status === "unmatched") return "destructive";
  return "secondary";
}

type TargetField = "name" | "quantity" | "condition" | "priceCents" | "notes" | "id";
const TARGET_FIELDS: { key: TargetField; label: string; required?: boolean }[] = [
  { key: "name", label: "Card name", required: true },
  { key: "quantity", label: "Quantity" },
  { key: "condition", label: "Condition" },
  { key: "priceCents", label: "Price" },
  { key: "notes", label: "Notes" },
  { key: "id", label: "Inventory item id (for editing existing rows)" },
];

type Stage = "upload" | "map" | "preview" | "done";

export default function ImportPage() {
  const [stage, setStage] = useState<Stage>("upload");
  const [error, setError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<TargetField, string>>>({});
  const [games, setGames] = useState<ActiveGame[]>([]);
  const [gameCode, setGameCode] = useState<string>("mtg");
  const [previewed, setPreviewed] = useState<PreviewedRow[]>([]);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [result, setResult] = useState<{ inserted: number; updated: number } | null>(null);

  useEffect(() => {
    getActiveGames().then((result) => {
      if ("games" in result) setGames(result.games);
    });
  }, []);

  function handleFile(file: File) {
    setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setHeaders(results.meta.fields ?? []);
        setRawRows(results.data);
        setStage("map");
      },
      error: (err) => setError(err.message),
    });
  }

  function buildMappedRows() {
    return rawRows.map((raw) => {
      const get = (field: TargetField) => {
        const header = mapping[field];
        return header ? raw[header]?.trim() : undefined;
      };

      const quantityRaw = get("quantity");
      const priceRaw = get("priceCents");

      return {
        id: get("id") || null,
        name: get("name") ?? "",
        quantity: quantityRaw ? Number(quantityRaw) : undefined,
        condition: (get("condition") as "NM" | "LP" | "MP" | "HP" | "DMG" | undefined) || undefined,
        priceCents: priceRaw ? Math.round(Number(priceRaw) * 100) : null,
        notes: get("notes") || null,
      };
    });
  }

  async function handlePreview() {
    setError(null);
    const rows = buildMappedRows().filter((r) => r.name);
    if (rows.length === 0) {
      setError("Map at least the card name column and ensure rows have names.");
      return;
    }

    const result = await previewImportRows({ gameCode, rows });
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setPreviewed(result.rows);
    setStage("preview");
  }

  async function handleCommit() {
    setError(null);
    const rows = previewed
      .map((p, i) => ({
        ...p.row,
        cardId: overrides[i] ?? p.matchedCardId ?? "",
      }))
      .filter((r) => r.cardId);

    if (rows.length === 0) {
      setError("No matched rows to import -- resolve at least one match first.");
      return;
    }

    const result = await commitImportRows({ gameCode, rows });
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setResult(result);
    setStage("done");
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Import inventory from CSV</h1>
        <Link href="/inventory" className="text-sm text-primary hover:underline">
          Back to inventory
        </Link>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {stage === "upload" && (
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-4">
            <label htmlFor="file" className="text-sm font-medium text-foreground">
              CSV file
            </label>
            <input
              id="file"
              type="file"
              accept=".csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
          </CardContent>
        </Card>
      )}

      {stage === "map" && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-4">
            <div className="flex flex-col gap-1.5 sm:w-64">
              <label htmlFor="gameCode" className="text-sm font-medium text-foreground">
                Game
              </label>
              <select id="gameCode" value={gameCode} onChange={(e) => setGameCode(e.target.value)} className={selectClassName}>
                {games.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <Table data-testid="mapping-table">
              <TableBody>
                {TARGET_FIELDS.map((field) => (
                  <TableRow key={field.key}>
                    <TableCell className="text-foreground">
                      {field.label}
                      {field.required ? " *" : ""}
                    </TableCell>
                    <TableCell>
                      <select
                        aria-label={`Map column for ${field.label}`}
                        value={mapping[field.key] ?? ""}
                        onChange={(e) =>
                          setMapping((prev) => ({ ...prev, [field.key]: e.target.value || undefined }))
                        }
                        className={selectClassName}
                      >
                        <option value="">-- none --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <p className="text-sm text-muted-foreground">{rawRows.length} rows loaded.</p>
            <div>
              <Button onClick={handlePreview} disabled={!mapping.name}>
                Preview
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "preview" && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-4">
            <div className="rounded-lg border border-border">
              <Table data-testid="preview-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Match</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewed.map((p, i) => (
                    <TableRow key={i} data-testid="preview-row" data-status={p.status}>
                      <TableCell className="text-foreground">{p.row.name}</TableCell>
                      <TableCell>
                        <Badge variant={previewStatusVariant(p.status)}>{p.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {p.status === "matched" && <span className="text-foreground">{p.candidates[0]?.name}</span>}
                        {p.status !== "matched" && p.candidates.length > 0 && (
                          <select
                            aria-label={`Resolve match for ${p.row.name}`}
                            value={overrides[i] ?? ""}
                            onChange={(e) => setOverrides((prev) => ({ ...prev, [i]: e.target.value }))}
                            className={selectClassName}
                          >
                            <option value="">-- choose --</option>
                            {p.candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.set_name})
                              </option>
                            ))}
                          </select>
                        )}
                        {p.status === "unmatched" && p.candidates.length === 0 && (
                          <span className="text-muted-foreground">No candidates found</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <Button onClick={handleCommit}>Commit import</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "done" && result && (
        <Badge variant="success" data-testid="import-result">
          Imported: {result.inserted} new, {result.updated} updated.
        </Badge>
      )}
    </main>
  );
}
