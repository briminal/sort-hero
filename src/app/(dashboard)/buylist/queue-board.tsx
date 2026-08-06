"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type SubmissionRow = {
  id: string;
  channel: "portal" | "pos";
  status: string;
  total_offer_cents: number | null;
  total_offer_credit_cents: number | null;
  created_at: string;
  buylist_customers: { name: string | null; email: string | null } | null;
};

const COLUMNS = [
  { status: "pending", label: "New" },
  { status: "priced", label: "Priced" },
  { status: "accepted", label: "Accepted" },
  { status: "completed", label: "Completed" },
  { status: "declined", label: "Declined" },
] as const;

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "success" | "destructive" | "outline"> = {
  pending: "default",
  priced: "secondary",
  accepted: "outline",
  completed: "success",
  declined: "destructive",
  cancelled: "destructive",
};

function dollars(cents: number | null) {
  return cents === null ? "-" : (cents / 100).toFixed(2);
}

export function QueueBoard({ storeId, initialSubmissions }: { storeId: string; initialSubmissions: SubmissionRow[] }) {
  const [submissions, setSubmissions] = useState<SubmissionRow[]>(initialSubmissions);

  useEffect(() => {
    const supabase = createClient();

    // Live queue for every screen watching this store's buylist -- Realtime,
    // not polling, per CLAUDE.md (same pattern as pos/tills/till-list.tsx).
    const channel = supabase
      .channel(`buylist-submissions-${storeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "buylist_submissions", filter: `store_id=eq.${storeId}` },
        (payload) => {
          setSubmissions((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as Omit<SubmissionRow, "buylist_customers">;
              return prev.some((s) => s.id === row.id)
                ? prev
                : [{ ...row, buylist_customers: null }, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as Omit<SubmissionRow, "buylist_customers">;
              return prev.map((s) => (s.id === row.id ? { ...s, ...row } : s));
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeId]);

  return (
    <div data-testid="buylist-queue" className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {COLUMNS.map((column) => {
        // `cancelled` is a valid status but no code path sets it today --
        // folded into Declined so a row can never silently vanish from the
        // board if that ever changes.
        const items = submissions.filter((s) =>
          column.status === "declined" ? s.status === "declined" || s.status === "cancelled" : s.status === column.status,
        );
        return (
          <div key={column.status} className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{column.label}</h2>
              <span className="text-xs font-medium text-muted-foreground">{items.length}</span>
            </div>

            <div className="flex flex-col gap-2">
              {items.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  Nothing here
                </p>
              )}
              {items.map((s) => (
                <Link key={s.id} href={`/buylist/${s.id}`} data-testid="buylist-queue-row" data-status={s.status}>
                  <Card className="transition-colors hover:border-primary/50 hover:bg-accent/40">
                    <CardHeader className="gap-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="truncate text-sm">
                          {s.buylist_customers?.name ?? s.buylist_customers?.email ?? "Walk-in"}
                        </CardTitle>
                        <Badge variant={STATUS_BADGE_VARIANT[s.status] ?? "outline"} className="shrink-0">
                          {s.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.channel === "pos" ? "In-person" : "Portal"}</p>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-1 p-3 pt-0 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">
                        ${dollars(s.total_offer_cents)} <span className="text-muted-foreground">cash</span> · $
                        {dollars(s.total_offer_credit_cents)} <span className="text-muted-foreground">credit</span>
                      </p>
                      <p>{new Date(s.created_at).toLocaleString()}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
