"use client";

import { useRef, useState } from "react";
import { searchCards } from "../../scanning/actions";
import { createPosBuy, previewBuylistOffer } from "../actions";
import type { ActiveGame } from "@/lib/games";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type CartLine = {
  cardId: string;
  cardName: string;
  condition: "NM" | "LP" | "MP" | "HP" | "DMG";
  quantity: number;
  cashUnitPriceCents: number;
  creditUnitPriceCents: number;
};

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

export function BuyTerminal({ games }: { games: ActiveGame[] }) {
  const [gameCode, setGameCode] = useState<string>(games[0]?.code ?? "mtg");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; set_name: string | null }[]>([]);
  const [condition, setCondition] = useState<CartLine["condition"]>("NM");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<"cash" | "store_credit">("cash");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completedSubmissionId, setCompletedSubmissionId] = useState<string | null>(null);

  // Cart lives in a ref (not just state) so rapid clicks don't race: each
  // addToCart call reads/writes cartRef synchronously before its `await`,
  // so a second click always builds on top of the first's result instead
  // of a stale snapshot -- the same fix this project already applied once
  // for the CSV editor's paste handler.
  const cartRef = useRef<CartLine[]>([]);

  function syncCart(next: CartLine[]) {
    cartRef.current = next;
    setCart(next);
  }

  function lineKey(l: { cardId: string; condition: string }) {
    return `${l.cardId}-${l.condition}`;
  }

  async function handleSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    const result = await searchCards({ gameCode, query: value });
    if ("candidates" in result) setResults(result.candidates);
  }

  async function addToCart(card: { id: string; name: string }) {
    setError(null);
    const key = lineKey({ cardId: card.id, condition });
    const current = cartRef.current;
    const existing = current.find((l) => lineKey(l) === key);
    const nextCart = existing
      ? current.map((l) => (lineKey(l) === key ? { ...l, quantity: l.quantity + 1 } : l))
      : [...current, { cardId: card.id, cardName: card.name, condition, quantity: 1, cashUnitPriceCents: 0, creditUnitPriceCents: 0 }];
    syncCart(nextCart);

    const preview = await previewBuylistOffer({
      items: nextCart.map((l) => ({ cardId: l.cardId, cardName: l.cardName, condition: l.condition, quantity: l.quantity })),
    });
    if ("error" in preview) {
      setError(preview.error);
      return;
    }

    // Merge fetched prices into the cart's *current* state by cardId+condition
    // (not by array index into nextCart), so a concurrent add that happened
    // while this request was in flight isn't clobbered or misaligned.
    const priceByKey = new Map(preview.lines.map((l) => [lineKey(l), l]));
    syncCart(
      cartRef.current.map((l) => {
        const match = priceByKey.get(lineKey(l));
        return match
          ? { ...l, cashUnitPriceCents: match.cashUnitPriceCents, creditUnitPriceCents: match.creditUnitPriceCents }
          : l;
      }),
    );
  }

  function removeFromCart(index: number) {
    syncCart(cartRef.current.filter((_, i) => i !== index));
  }

  function unitPriceFor(line: CartLine) {
    return payoutMethod === "store_credit" ? line.creditUnitPriceCents : line.cashUnitPriceCents;
  }

  const totalCents = cart.reduce((sum, l) => sum + unitPriceFor(l) * l.quantity, 0);

  async function handleSubmit() {
    setError(null);
    if (payoutMethod === "store_credit" && !customerEmail.trim()) {
      setError("Store credit requires a customer email so the balance can be looked up later.");
      return;
    }
    setBusy(true);
    const result = await createPosBuy({
      customer: { name: customerName || undefined, email: customerEmail || undefined, phone: customerPhone || undefined },
      items: cart.map((l) => ({ cardId: l.cardId, cardName: l.cardName, condition: l.condition, quantity: l.quantity })),
      payoutMethod,
    });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setCompletedSubmissionId(result.submissionId);
    syncCart([]);
    setCustomerName("");
    setCustomerEmail("");
    setCustomerPhone("");
  }

  if (completedSubmissionId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 pt-4">
          <Badge variant="success" data-testid="buy-complete">
            Buy complete (submission {completedSubmissionId})
          </Badge>
          <Button onClick={() => setCompletedSubmissionId(null)}>New buy</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="buyGameCode">Game</Label>
          <select id="buyGameCode" value={gameCode} onChange={(e) => setGameCode(e.target.value)} className={selectClassName}>
            {games.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="buyCondition">Condition</Label>
          <select
            id="buyCondition"
            value={condition}
            onChange={(e) => setCondition(e.target.value as CartLine["condition"])}
            className={selectClassName}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="buySearch">Search cards</Label>
          <Input id="buySearch" value={query} onChange={(e) => handleSearch(e.target.value)} placeholder="Card name" className="w-64" />
        </div>
      </div>

      {results.length > 0 && (
        <ul data-testid="buy-search-results" className="flex flex-col gap-1.5">
          {results.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span className="text-foreground">
                {r.name} <span className="text-muted-foreground">({r.set_name})</span>
              </span>
              <Button size="sm" onClick={() => addToCart(r)}>
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cart</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul data-testid="buy-cart" className="flex flex-col gap-1.5">
            {cart.map((line, i) => (
              <li
                key={`${line.cardId}-${line.condition}`}
                data-testid="buy-cart-line"
                className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground"
              >
                <span>
                  {line.cardName} ({line.condition}) × {line.quantity} @ ${dollars(unitPriceFor(line))} = $
                  {dollars(unitPriceFor(line) * line.quantity)}
                  <span className="ml-1 text-muted-foreground">
                    (cash ${dollars(line.cashUnitPriceCents)} / credit ${dollars(line.creditUnitPriceCents)})
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => removeFromCart(i)}>
                  Remove
                </Button>
              </li>
            ))}
            {cart.length === 0 && <li className="text-sm text-muted-foreground">Cart is empty.</li>}
          </ul>
          <p data-testid="buy-total" className="text-lg font-semibold text-foreground">
            Total offer: ${dollars(totalCents)}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerName">Customer name</Label>
          <Input id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerEmail">Customer email</Label>
          <Input id="customerEmail" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerPhone">Customer phone</Label>
          <Input id="customerPhone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:w-56">
        <Label htmlFor="payoutMethod">Payout method</Label>
        <select
          id="payoutMethod"
          value={payoutMethod}
          onChange={(e) => setPayoutMethod(e.target.value as "cash" | "store_credit")}
          className={selectClassName}
        >
          <option value="cash">Cash</option>
          <option value="store_credit">Store credit</option>
        </select>
      </div>

      <div>
        <Button onClick={handleSubmit} disabled={cart.length === 0 || busy}>
          {busy ? "Processing..." : "Complete buy"}
        </Button>
      </div>
    </div>
  );
}
