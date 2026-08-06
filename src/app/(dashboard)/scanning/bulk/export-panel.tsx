"use client";

import { useState } from "react";
import { priceCentsFor, type BulkRow } from "./bulk-scanner";
import { buildCsv } from "@/lib/csv/export";
import { scanExportTemplates, type ScanExportRow } from "@/lib/csv/scan-templates";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function rowToExportRow(row: BulkRow, cardName: string, setName: string | null, collectorNumber: string | null, rarity: string | null): ScanExportRow {
  return {
    cardName,
    setName,
    collectorNumber,
    rarity,
    condition: row.condition,
    printing: row.printing,
    language: row.language,
    quantity: row.quantity,
    marketPriceCents: row.marketPriceCents,
    lowPriceCents: row.lowPriceCents,
    costCents: row.costCents,
    confidence: row.confidence,
    fileName: row.fileName,
    notes: row.notes,
  };
}

/** Sums quantities for rows that are otherwise identical (same card,
 * condition, printing, language) -- multiple photos of the same card in one
 * batch shouldn't produce duplicate export lines. */
function mergeExportRows(rows: ScanExportRow[]): ScanExportRow[] {
  const byKey = new Map<string, ScanExportRow>();
  for (const row of rows) {
    const key = `${row.cardName}|${row.setName}|${row.condition}|${row.printing}|${row.language}`;
    const existing = byKey.get(key);
    if (existing) existing.quantity += row.quantity;
    else byKey.set(key, { ...row });
  }
  return [...byKey.values()];
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportPanel({ rows, priceBasis, thresholdCents }: { rows: BulkRow[]; priceBasis: "market" | "low"; thresholdCents: number }) {
  const [exportName, setExportName] = useState("");
  const [templateId, setTemplateId] = useState("sorthero");
  const [mergeItems, setMergeItems] = useState(false);
  const [splitHighValue, setSplitHighValue] = useState(false);
  const [busy, setBusy] = useState(false);

  function buildRows(): ScanExportRow[] {
    const active = rows.filter((r) => !r.excluded && r.selectedCardId);
    const exportRows = active.map((row) => {
      const candidate = row.candidates.find((c) => c.id === row.selectedCardId);
      return rowToExportRow(row, candidate?.name ?? row.ocrQuery, candidate?.set_name ?? null, candidate?.collector_number ?? null, candidate?.rarity ?? null);
    });
    return mergeItems ? mergeExportRows(exportRows) : exportRows;
  }

  function splitByHighValue(exportRows: ScanExportRow[]): { highValue: ScanExportRow[]; bulk: ScanExportRow[] } {
    const highValue: ScanExportRow[] = [];
    const bulk: ScanExportRow[] = [];
    for (const row of exportRows) {
      const price = priceBasis === "low" ? row.lowPriceCents : row.marketPriceCents;
      (price !== null && price >= thresholdCents ? highValue : bulk).push(row);
    }
    return { highValue, bulk };
  }

  function baseName() {
    return exportName.trim() || "scan-export";
  }

  function handleExportCsv() {
    const template = scanExportTemplates[templateId] ?? scanExportTemplates.sorthero!;
    const exportRows = buildRows();

    if (splitHighValue) {
      const { highValue, bulk } = splitByHighValue(exportRows);
      if (highValue.length > 0) downloadBlob(new Blob([buildCsv(template, highValue)], { type: "text/csv" }), `${baseName()}_high-value.csv`);
      if (bulk.length > 0) downloadBlob(new Blob([buildCsv(template, bulk)], { type: "text/csv" }), `${baseName()}_bulk.csv`);
    } else {
      downloadBlob(new Blob([buildCsv(template, exportRows)], { type: "text/csv" }), `${baseName()}.csv`);
    }
  }

  async function handleExportXls() {
    setBusy(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const template = scanExportTemplates[templateId] ?? scanExportTemplates.sorthero!;
      const exportRows = buildRows();

      async function writeWorkbook(sheetRows: ScanExportRow[], fileSuffix: string) {
        if (sheetRows.length === 0) return;
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Cards");
        sheet.columns = template.columns.map((col) => ({ header: col.header, key: col.key, width: 20 }));
        for (const row of sheetRows) {
          sheet.addRow(Object.fromEntries(template.columns.map((col) => [col.key, col.get(row)])));
        }
        const buffer = await workbook.xlsx.writeBuffer();
        downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${baseName()}${fileSuffix}.xlsx`);
      }

      if (splitHighValue) {
        const { highValue, bulk } = splitByHighValue(exportRows);
        await writeWorkbook(highValue, "_high-value");
        await writeWorkbook(bulk, "_bulk");
      } else {
        await writeWorkbook(exportRows, "");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="export-name">Export Name</Label>
          <Input id="export-name" value={exportName} onChange={(e) => setExportName(e.target.value)} placeholder="Enter file name" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="export-template">Export Template</Label>
          <select id="export-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={selectClassName}>
            {Object.values(scanExportTemplates).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={mergeItems} onChange={(e) => setMergeItems(e.target.checked)} className="size-4 rounded border-input accent-primary" />
          Merge Items
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={splitHighValue}
            onChange={(e) => setSplitHighValue(e.target.checked)}
            className="size-4 rounded border-input accent-primary"
          />
          Split High Value
        </label>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleExportCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
          <Button type="button" variant="outline" onClick={handleExportXls} disabled={rows.length === 0 || busy}>
            {busy ? "Exporting..." : "Export XLS"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
