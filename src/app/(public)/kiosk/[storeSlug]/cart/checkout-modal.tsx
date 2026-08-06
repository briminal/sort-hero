"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitKioskReservation } from "../actions";
import type { KioskCartLine } from "@/lib/kiosk/cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CheckoutModal({
  storeSlug,
  cart,
  onClose,
  onSuccess,
}: {
  storeSlug: string;
  cart: KioskCartLine[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [nameOrPhone, setNameOrPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!nameOrPhone.trim()) return;
    setError(null);
    setSubmitting(true);

    const result = await submitKioskReservation({
      storeSlug,
      customerNameOrPhone: nameOrPhone.trim(),
      items: cart.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity })),
    });
    setSubmitting(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    onSuccess();
    router.push(`/kiosk/${storeSlug}/order-confirmed`);
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5">
        <h2 className="mb-1 text-lg font-semibold text-foreground">Complete Checkout</h2>
        <p className="mb-4 text-sm text-muted-foreground">Please enter your name or phone number to complete your order:</p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="checkout-name-phone">Name or Phone</Label>
          <Input
            id="checkout-name-phone"
            value={nameOrPhone}
            onChange={(e) => setNameOrPhone(e.target.value)}
            autoFocus
            disabled={submitting}
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={submitting || !nameOrPhone.trim()}>
            {submitting ? "Submitting..." : "Confirm Order"}
          </Button>
        </div>
      </div>
    </div>
  );
}
