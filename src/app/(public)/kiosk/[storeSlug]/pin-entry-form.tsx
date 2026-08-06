"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { verifyKioskPin } from "./actions";
import { Button } from "@/components/ui/button";

export function PinEntryForm({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await verifyKioskPin({ storeSlug, pin });
    setSubmitting(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    if (!result.ok) {
      setPin("");
      if (result.lockedUntil) {
        setLockedUntil(result.lockedUntil);
        setError(`Too many attempts. Try again after ${new Date(result.lockedUntil).toLocaleTimeString()}.`);
      } else {
        setError(`Incorrect PIN. ${result.attemptsRemaining} attempt(s) remaining.`);
      }
      return;
    }

    router.refresh();
  }

  const isLocked = lockedUntil !== null && new Date(lockedUntil) > new Date();

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-xs text-center">
        <h1 className="mb-1 text-xl font-semibold text-foreground">{storeName}</h1>
        <p className="mb-6 text-sm text-muted-foreground">Enter the kiosk PIN to browse inventory</p>

        <label htmlFor="kiosk-pin" className="sr-only">
          PIN
        </label>
        <input
          id="kiosk-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          disabled={submitting || isLocked}
          className="mb-4 w-full rounded-md border border-input bg-background p-4 text-center text-2xl tracking-widest text-foreground disabled:opacity-50"
          placeholder="••••"
        />

        {error && (
          <p role="alert" className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" disabled={submitting || isLocked || pin.length < 4} className="w-full py-4 text-lg">
          {submitting ? "Checking..." : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
