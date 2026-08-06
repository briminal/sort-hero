"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { disconnectMarketplace, triggerSyncNow, updateConnectionSettings } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ConnectionRow = {
  id: string;
  platform: "shopify" | "tcgplayer";
  status: "disconnected" | "connected" | "error";
  shop_domain: string | null;
  tcgplayer_store_key: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  auto_sync_enabled: boolean;
};

export type SyncJobRunRow = {
  id: string;
  job_type: string;
  status: "running" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
  error: string | null;
  items_processed: number | null;
};

function statusVariant(status: string): "success" | "destructive" | "secondary" {
  if (status === "connected" || status === "succeeded") return "success";
  if (status === "error" || status === "failed") return "destructive";
  return "secondary";
}

export function SyncStatus({
  storeId,
  connection: initialConnection,
  initialRuns,
}: {
  storeId: string;
  connection: ConnectionRow;
  initialRuns: SyncJobRunRow[];
}) {
  const [connection, setConnection] = useState(initialConnection);
  const [runs, setRuns] = useState(initialRuns);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // Live sync status -- Realtime, not polling, per CLAUDE.md (same
    // pattern as pos/tills/till-list.tsx).
    const channel = supabase
      .channel(`marketplace-sync-${storeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sync_job_runs", filter: `store_id=eq.${storeId}` },
        (payload) => {
          setRuns((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as SyncJobRunRow;
              return prev.some((r) => r.id === row.id) ? prev : [row, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as SyncJobRunRow;
              return prev.map((r) => (r.id === row.id ? row : r));
            }
            return prev;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "marketplace_connections", filter: `store_id=eq.${storeId}` },
        (payload) => {
          const row = payload.new as ConnectionRow;
          if (row.id === connection.id) setConnection(row);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeId, connection.id]);

  async function handleDisconnect() {
    setError(null);
    setBusy(true);
    const result = await disconnectMarketplace({ connectionId: connection.id });
    setBusy(false);
    if ("error" in result) setError(result.error);
  }

  async function handleToggleAutoSync() {
    setError(null);
    setBusy(true);
    const nextValue = !connection.auto_sync_enabled;
    const result = await updateConnectionSettings({ connectionId: connection.id, autoSyncEnabled: nextValue });
    setBusy(false);
    if ("error" in result) setError(result.error);
    else setConnection((prev) => ({ ...prev, auto_sync_enabled: nextValue }));
  }

  async function handleSyncNow() {
    setError(null);
    setBusy(true);
    const jobType = connection.platform === "shopify" ? "push_listings" : "pull_orders";
    const result = await triggerSyncNow({ connectionId: connection.id, jobType });
    setBusy(false);
    if ("error" in result) setError(result.error);
  }

  const platformRuns = runs.filter((r) =>
    connection.platform === "shopify" ? r.job_type === "push_listings" : r.job_type === "pull_orders",
  );

  return (
    <div data-testid={`sync-status-${connection.platform}`} data-status={connection.status} className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={statusVariant(connection.status)}>{connection.status}</Badge>
        {connection.shop_domain && <span className="text-muted-foreground">{connection.shop_domain}</span>}
        {connection.tcgplayer_store_key && <span className="text-muted-foreground">{connection.tcgplayer_store_key}</span>}
      </div>

      {connection.last_synced_at && (
        <p className="text-sm text-muted-foreground">Last synced: {new Date(connection.last_synced_at).toLocaleString()}</p>
      )}
      {connection.last_error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Last error: {connection.last_error}
        </p>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={connection.auto_sync_enabled} onChange={handleToggleAutoSync} disabled={busy} className="size-4 rounded border-input" />
        Auto-sync
      </label>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSyncNow} disabled={busy}>
          Sync now
        </Button>
        <Button size="sm" variant="outline" onClick={handleDisconnect} disabled={busy}>
          Disconnect
        </Button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Recent syncs</h3>
        <ul data-testid="sync-job-runs" className="flex flex-col gap-1.5">
          {platformRuns.slice(0, 10).map((run) => (
            <li
              key={run.id}
              data-testid="sync-job-run-row"
              data-run-status={run.status}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
              <span className="text-foreground">{run.job_type}</span>
              <span className="text-muted-foreground">{new Date(run.started_at).toLocaleString()}</span>
              {run.items_processed !== null && <span className="text-muted-foreground">{run.items_processed} item(s)</span>}
              {run.error && <span className="text-destructive">{run.error}</span>}
            </li>
          ))}
          {platformRuns.length === 0 && <li className="text-sm text-muted-foreground">No syncs yet.</li>}
        </ul>
      </div>
    </div>
  );
}
