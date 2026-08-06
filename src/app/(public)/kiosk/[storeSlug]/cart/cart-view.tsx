"use client";

import { useState } from "react";
import Link from "next/link";
import { useKioskCart } from "@/hooks/use-kiosk-cart";
import { cartTotalCents } from "@/lib/kiosk/cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckoutModal } from "./checkout-modal";

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function CartView({ storeSlug }: { storeSlug: string }) {
  const [cart, setCart] = useKioskCart(storeSlug);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  function updateQuantity(inventoryItemId: string, quantity: number) {
    setCart(
      cart
        .map((l) => (l.inventoryItemId === inventoryItemId ? { ...l, quantity: Math.max(0, Math.min(quantity, l.maxQuantity)) } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(inventoryItemId: string) {
    setCart(cart.filter((l) => l.inventoryItemId !== inventoryItemId));
  }

  function clearAll() {
    if (window.confirm("Are you sure you want to clear all items from your cart?")) {
      setCart([]);
    }
  }

  const total = cartTotalCents(cart);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <Link href={`/kiosk/${storeSlug}`} className="flex items-center gap-2 text-foreground hover:text-primary">
          <span aria-hidden>←</span>
          <h1 className="text-lg font-semibold">Your Cart ({cart.length} item{cart.length === 1 ? "" : "s"})</h1>
        </Link>
        {cart.length > 0 && (
          <button type="button" onClick={clearAll} className="text-sm text-destructive hover:underline">
            Clear All
          </button>
        )}
      </div>

      {cart.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Your cart is empty.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {cart.map((line) => (
              <li key={line.inventoryItemId} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                {line.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={line.imageUrl} alt={line.cardName} className="h-16 w-auto rounded object-cover" />
                ) : (
                  <div className="flex h-16 w-12 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">No image</div>
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{line.cardName}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.condition} / {line.printing === "foil" ? "Foil" : "Normal"}
                  </p>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={line.maxQuantity}
                  value={line.quantity}
                  onChange={(e) => updateQuantity(line.inventoryItemId, Number(e.target.value))}
                  aria-label={`Quantity for ${line.cardName}`}
                  className="h-9 w-16"
                />
                <div className="w-24 text-right text-sm">
                  <p className="text-muted-foreground">{dollars(line.priceCents)} each</p>
                  <p className="font-semibold text-foreground">Subtotal: {dollars(line.priceCents * line.quantity)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(line.inventoryItemId)}
                  aria-label={`Remove ${line.cardName}`}
                  className="text-destructive hover:opacity-80"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-medium text-foreground">
                Total ({cart.reduce((sum, l) => sum + l.quantity, 0)} items):
              </span>
              <span className="text-lg font-semibold text-primary">{dollars(total)}</span>
            </div>
            <Button type="button" className="w-full" onClick={() => setCheckoutOpen(true)}>
              Proceed to Checkout
            </Button>
          </div>
        </>
      )}

      {checkoutOpen && (
        <CheckoutModal
          storeSlug={storeSlug}
          cart={cart}
          onClose={() => setCheckoutOpen(false)}
          onSuccess={() => setCart([])}
        />
      )}
    </div>
  );
}
