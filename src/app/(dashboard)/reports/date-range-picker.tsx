"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DateRangePreset } from "@/lib/reports/date-range";

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom" },
];

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function DateRangePicker({ preset, from, to }: { preset: DateRangePreset; from: string; to: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The server has no way to know the shop's actual timezone (it may be
  // deployed in UTC while staff are anywhere) -- capture it here on first
  // render so even the very first page load, before any user interaction,
  // resolves "Today" etc. against the shop's real calendar day rather than
  // the server's. router.replace (not push) so this doesn't add a history
  // entry.
  useEffect(() => {
    if (searchParams.get("tz")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tz", browserTimeZone());
    router.replace(`/reports?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function withTimeZone(params: URLSearchParams): URLSearchParams {
    params.set("tz", browserTimeZone());
    return params;
  }

  function setPreset(next: DateRangePreset) {
    const params = withTimeZone(new URLSearchParams(searchParams.toString()));
    params.set("range", next);
    if (next !== "custom") {
      params.delete("from");
      params.delete("to");
    }
    router.push(`/reports?${params.toString()}`);
  }

  function setCustom(key: "from" | "to", value: string) {
    const params = withTimeZone(new URLSearchParams(searchParams.toString()));
    params.set("range", "custom");
    params.set(key, value);
    router.push(`/reports?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1 rounded-md border border-border bg-card p-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={preset === p.value}
            onClick={() => setPreset(p.value)}
            className={`rounded px-3 py-1 text-sm font-medium ${
              preset === p.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-2 text-sm text-foreground">
          <label htmlFor="reports-from" className="sr-only">
            From date
          </label>
          <input
            id="reports-from"
            type="date"
            value={from.slice(0, 10)}
            onChange={(e) => setCustom("from", e.target.value)}
            className="rounded-md border border-input bg-background p-2 text-foreground"
          />
          <span>to</span>
          <label htmlFor="reports-to" className="sr-only">
            To date
          </label>
          <input
            id="reports-to"
            type="date"
            value={to.slice(0, 10)}
            onChange={(e) => setCustom("to", e.target.value)}
            className="rounded-md border border-input bg-background p-2 text-foreground"
          />
        </div>
      )}
    </div>
  );
}
