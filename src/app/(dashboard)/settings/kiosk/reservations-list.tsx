"use client";

import { useState } from "react";
import Link from "next/link";
import { completeKioskReservation } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ReservationRow = {
  id: string;
  customerNameOrPhone: string;
  totalCents: number;
  createdAt: string;
  itemCount: number;
};

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ReservationsList({ initialReservations }: { initialReservations: ReservationRow[] }) {
  const [reservations, setReservations] = useState(initialReservations);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete(id: string) {
    setError(null);
    setBusyId(id);
    const result = await completeKioskReservation({ reservationId: id });
    setBusyId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setReservations((prev) => prev.filter((r) => r.id !== id));
  }

  if (reservations.length === 0) {
    return <p className="text-sm text-muted-foreground">No pending kiosk reservations.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {reservations.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Pending</Badge>
            <span className="font-medium text-foreground">{r.customerNameOrPhone}</span>
            <span className="text-muted-foreground">
              {r.itemCount} item{r.itemCount === 1 ? "" : "s"} · {dollars(r.totalCents)}
            </span>
            <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleTimeString()}</span>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href={`/pos?reservation=${r.id}`}>Load into POS</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleComplete(r.id)} disabled={busyId === r.id}>
              {busyId === r.id ? "..." : "Mark Completed"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
