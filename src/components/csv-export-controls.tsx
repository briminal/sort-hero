"use client";

import { useState } from "react";
import { ALL_FIELDS, exportTemplates } from "@/lib/csv/templates";
import { Button } from "@/components/ui/button";

const DEFAULT_CUSTOM_FIELDS = ["card_name", "set_name", "quantity", "price_cents"];

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function CsvExportControls({
  baseUrl,
  extraParams,
}: {
  baseUrl: string;
  extraParams: Record<string, string>;
}) {
  const [template, setTemplate] = useState("generic");
  const [customFields, setCustomFields] = useState<Set<string>>(new Set(DEFAULT_CUSTOM_FIELDS));

  function toggleField(key: string) {
    setCustomFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportUrl() {
    const params = new URLSearchParams(extraParams);
    if (template === "custom") {
      params.set("fields", [...customFields].join(","));
    } else {
      params.set("template", template);
    }
    return `${baseUrl}?${params.toString()}`;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="exportTemplate" className="text-xs font-medium text-muted-foreground">
        Export template
      </label>
      <select id="exportTemplate" value={template} onChange={(e) => setTemplate(e.target.value)} className={selectClassName}>
        {Object.values(exportTemplates).map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
        <option value="custom">Custom columns</option>
      </select>

      {template === "custom" && (
        <fieldset className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Columns to include</legend>
          {ALL_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={customFields.has(f.key)}
                onChange={() => toggleField(f.key)}
                className="size-4 rounded border-input"
              />
              {f.header}
            </label>
          ))}
        </fieldset>
      )}

      <Button size="sm" variant="outline" asChild>
        <a href={exportUrl()}>Export CSV</a>
      </Button>
    </div>
  );
}
