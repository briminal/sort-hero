"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { closeTill, openTill } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type TillRow = {
  id: string;
  name: string;
  status: "open" | "closed";
  opening_cash_cents: number | null;
  closing_cash_cents: number | null;
  opened_at: string | null;
  closed_at: string | null;
};

function dollars(cents: number | null) {
  return cents === null ? "-" : (cents / 100).toFixed(2);
}

export function TillList({ storeId, initialTills }: { storeId: string; initialTills: TillRow[] }) {
  const [tills, setTills] = useState<TillRow[]>(initialTills);
  const [newTillName, setNewTillName] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [closingCashById, setClosingCashById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // Live till status for every screen watching this store -- Realtime,
    // not polling, per CLAUDE.md.
    const channel = supabase
      .channel(`tills-${storeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tills", filter: `store_id=eq.${storeId}` },
        (payload) => {
          setTills((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as TillRow;
              return prev.some((t) => t.id === row.id) ? prev : [row, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as TillRow;
              return prev.map((t) => (t.id === row.id ? row : t));
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

  async function handleOpen() {
    setError(null);
    const result = await openTill({
      name: newTillName || `Register ${tills.length + 1}`,
      openingCashCents: Math.round(Number(openingCash) * 100) || 0,
    });
    if ("error" in result) setError(result.error);
    else {
      setNewTillName("");
      setOpeningCash("0");
    }
  }

  async function handleClose(tillId: string) {
    setError(null);
    const closingCash = closingCashById[tillId] ?? "0";
    const result = await closeTill({
      tillId,
      closingCashCents: Math.round(Number(closingCash) * 100) || 0,
    });
    if ("error" in result) setError(result.error);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Open a new till</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newTillName">Till name</Label>
            <Input
              id="newTillName"
              value={newTillName}
              onChange={(e) => setNewTillName(e.target.value)}
              placeholder="Register 1"
              className="w-48"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="openingCash">Opening cash</Label>
            <Input
              id="openingCash"
              type="number"
              step="0.01"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              className="w-32"
            />
          </div>
          <Button onClick={handleOpen}>Open till</Button>
        </CardContent>
      </Card>

      <ul data-testid="till-list" className="flex flex-col gap-2">
        {tills.map((till) => (
          <li key={till.id} data-testid="till-row" data-status={till.status}>
            <Card>
              <CardContent className="flex flex-wrap items-end gap-3 pt-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{till.name}</span>
                  <Badge variant={till.status === "open" ? "success" : "secondary"}>{till.status}</Badge>
                  <span className="text-sm text-muted-foreground">opened ${dollars(till.opening_cash_cents)}</span>
                </div>
                {till.status === "open" && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`closingCash-${till.id}`}>Closing cash</Label>
                      <Input
                        id={`closingCash-${till.id}`}
                        type="number"
                        step="0.01"
                        value={closingCashById[till.id] ?? "0"}
                        onChange={(e) =>
                          setClosingCashById((prev) => ({ ...prev, [till.id]: e.target.value }))
                        }
                        className="w-32"
                      />
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleClose(till.id)}>
                      Close till
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
