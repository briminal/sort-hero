"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  browseCards,
  getSetsForGamePublic,
  previewOffer,
  submitBuylist,
  type BrowseCard,
  type SetOption,
} from "./actions";
import type { ActiveGame } from "@/lib/games";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
const PRINTINGS = ["normal", "foil"] as const;
const PAGE_SIZE = 24;

type Condition = (typeof CONDITIONS)[number];
type PayoutType = "cash" | "credit";

type CartLine = {
  cardId: string;
  cardName: string;
  imageUrl: string | null;
  condition: Condition;
  printing: string;
  language: string;
  quantity: number;
  payoutType: PayoutType;
  notes: string;
  cashUnitPriceCents: number;
  creditUnitPriceCents: number;
};

export type CheckoutMessagingConfig = {
  checkoutMessage: string | null;
  cashIncentiveMessage: string | null;
  creditIncentiveMessage: string | null;
  termsText: string | null;
  requireTermsAcceptance: boolean;
  dropInEnabled: boolean;
  dropInMessage: string | null;
  deliveryEnabled: boolean;
  deliveryMessage: string | null;
  addressAcknowledgmentMessage: string | null;
};

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function lineKey(l: { cardId: string; condition: string; printing: string; language: string }) {
  return `${l.cardId}-${l.condition}-${l.printing}-${l.language}`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PortalForm({
  storeSlug,
  games,
  checkoutConfig,
}: {
  storeSlug: string;
  games: ActiveGame[];
  checkoutConfig: CheckoutMessagingConfig;
}) {
  const [screen, setScreen] = useState<"picker" | "browse">("picker");
  const [gameCode, setGameCode] = useState<string>(games[0]?.code ?? "");
  const [defaultPayoutType, setDefaultPayoutType] = useState<PayoutType>("cash");

  const [query, setQuery] = useState("");
  const [sets, setSets] = useState<SetOption[]>([]);
  const [setId, setSetId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [cards, setCards] = useState<BrowseCard[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [priceByCardId, setPriceByCardId] = useState<Record<string, { cash: number; credit: number }>>({});
  const [choiceByCardId, setChoiceByCardId] = useState<
    Record<string, { condition: Condition; printing: string; language: string }>
  >({});
  const refetchSeqRef = useRef<Record<string, number>>({});
  // Tracks cards whose displayed price is stale relative to their current
  // condition choice (a refetch is in flight) -- addToCart must not use
  // priceByCardId for these until it clears, or a quick condition-change
  // followed immediately by "Add to Buylist" would attach the OLD
  // condition's price to the NEW condition's cart line.
  const [pendingPriceCardIds, setPendingPriceCardIds] = useState<Set<string>>(new Set());

  const [cart, setCart] = useState<CartLine[]>([]);
  const cartRef = useRef<CartLine[]>([]);
  function syncCart(next: CartLine[]) {
    cartRef.current = next;
    setCart(next);
  }

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"drop_in" | "delivery">(
    checkoutConfig.dropInEnabled ? "drop_in" : "delivery",
  );
  const [paymentAccount, setPaymentAccount] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [addressAck, setAddressAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  function chooseGame(code: string) {
    setGameCode(code);
    setScreen("browse");
    setSetId(null);
    setQuery("");
    setPage(1);
  }

  useEffect(() => {
    if (screen !== "browse") return;
    getSetsForGamePublic(gameCode).then((result) => {
      if (Array.isArray(result)) setSets(result);
    });
  }, [screen, gameCode]);

  useEffect(() => {
    if (screen !== "browse") return;
    browseCards({ gameCode, setId, query: query.trim() || undefined, page }).then((result) => {
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setCards(result.cards);
      setTotalCount(result.totalCount);
    });
  }, [screen, gameCode, setId, query, page]);

  function choiceFor(cardId: string) {
    return choiceByCardId[cardId] ?? { condition: "NM" as Condition, printing: "normal", language: "EN" };
  }

  // One batched price lookup per page load (all visible cards at their
  // current condition) instead of one request per card tile.
  useEffect(() => {
    if (cards.length === 0) return;
    let cancelled = false;
    previewOffer({
      storeSlug,
      items: cards.map((c) => ({ cardId: c.id, cardName: c.name, condition: choiceFor(c.id).condition, quantity: 1 })),
    }).then((result) => {
      if (cancelled || "error" in result) return;
      setPriceByCardId((prev) => {
        const next = { ...prev };
        for (const line of result.lines) next[line.cardId] = { cash: line.cashUnitPriceCents, credit: line.creditUnitPriceCents };
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  async function refetchPrice(cardId: string, cardName: string, condition: Condition) {
    const requestId = (refetchSeqRef.current[cardId] ?? 0) + 1;
    refetchSeqRef.current[cardId] = requestId;
    const result = await previewOffer({ storeSlug, items: [{ cardId, cardName, condition, quantity: 1 }] });
    // A rapid follow-up condition change may have started a newer request
    // for this card that's still in flight -- if so, drop this stale result
    // instead of letting it clobber the fresher one.
    if (refetchSeqRef.current[cardId] !== requestId) return;
    setPendingPriceCardIds((prev) => {
      if (!prev.has(cardId)) return prev;
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
    if ("error" in result) return;
    const line = result.lines[0];
    if (line) setPriceByCardId((prev) => ({ ...prev, [cardId]: { cash: line.cashUnitPriceCents, credit: line.creditUnitPriceCents } }));
  }

  function updateChoice(card: BrowseCard, field: "condition" | "printing" | "language", value: string) {
    setChoiceByCardId((prev) => ({ ...prev, [card.id]: { ...choiceFor(card.id), [field]: value } }));
    if (field === "condition") {
      setPendingPriceCardIds((prev) => new Set(prev).add(card.id));
      refetchPrice(card.id, card.name, value as Condition);
    }
  }

  function addToCart(card: BrowseCard) {
    if (pendingPriceCardIds.has(card.id)) return;
    const choice = choiceFor(card.id);
    const price = priceByCardId[card.id];
    if (!price || (price.cash === 0 && price.credit === 0)) return;

    const key = lineKey({ cardId: card.id, ...choice });
    const current = cartRef.current;
    const existing = current.find((l) => lineKey(l) === key);
    const next = existing
      ? current.map((l) => (lineKey(l) === key ? { ...l, quantity: l.quantity + 1 } : l))
      : [
          ...current,
          {
            cardId: card.id,
            cardName: card.name,
            imageUrl: card.imageUrl,
            condition: choice.condition,
            printing: choice.printing,
            language: choice.language,
            quantity: 1,
            payoutType: defaultPayoutType,
            notes: "",
            cashUnitPriceCents: price.cash,
            creditUnitPriceCents: price.credit,
          },
        ];
    syncCart(next);
  }

  function updateLine(key: string, patch: Partial<CartLine>) {
    syncCart(cartRef.current.map((l) => (lineKey(l) === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    syncCart(cartRef.current.filter((l) => lineKey(l) !== key));
  }

  function unitPriceFor(line: CartLine) {
    return line.payoutType === "credit" ? line.creditUnitPriceCents : line.cashUnitPriceCents;
  }

  const cartTotalCents = cart.reduce((sum, l) => sum + unitPriceFor(l) * l.quantity, 0);
  const cartCashTotalCents = cart.reduce((sum, l) => sum + l.cashUnitPriceCents * l.quantity, 0);
  const cartCreditTotalCents = cart.reduce((sum, l) => sum + l.creditUnitPriceCents * l.quantity, 0);

  function exportCartCsv() {
    downloadCsv("buylist-cart.csv", [
      ["Card", "Condition", "Printing", "Language", "Quantity", "Payout", "Unit Price", "Line Total"],
      ...cart.map((l) => [
        l.cardName,
        l.condition,
        l.printing,
        l.language,
        String(l.quantity),
        l.payoutType,
        dollars(unitPriceFor(l)),
        dollars(unitPriceFor(l) * l.quantity),
      ]),
    ]);
  }

  async function handleSubmit() {
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (checkoutConfig.requireTermsAcceptance && !acceptedTerms) {
      setError("Please accept the terms before submitting.");
      return;
    }
    if (checkoutConfig.addressAcknowledgmentMessage && !addressAck) {
      setError("Please acknowledge the address message before submitting.");
      return;
    }
    setBusy(true);
    const result = await submitBuylist({
      storeSlug,
      customer: { name, email, phone: phone || undefined },
      items: cart.map((l) => ({
        cardId: l.cardId,
        cardName: l.cardName,
        condition: l.condition,
        quantity: l.quantity,
        payoutType: l.payoutType,
        printing: l.printing,
        language: l.language,
        notes: l.notes || null,
      })),
      fulfillmentMethod,
      paymentAccount: paymentAccount || null,
      orderNotes: orderNotes || null,
      acceptedTerms,
      addressAcknowledged: addressAck,
    });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setAccessToken(result.accessToken);
  }

  if (accessToken) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center">
        <p data-testid="portal-submit-complete" className="text-lg font-semibold">
          Submitted! Save this link to track your offer and chat with the shop:
        </p>
        <Link
          href={`/buylist-portal/${storeSlug}/status/${accessToken}`}
          className="text-primary underline underline-offset-4"
        >
          View submission status
        </Link>
      </div>
    );
  }

  if (screen === "picker") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-8 p-10 text-center">
        <div>
          <h1 className="text-xl font-semibold">Which cards do you want to sell?</h1>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          {games.map((g) => (
            <button
              key={g.code}
              onClick={() => chooseGame(g.code)}
              className="rounded-md border border-border bg-card px-6 py-4 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-primary hover:bg-accent"
            >
              {g.name}
            </button>
          ))}
        </div>

        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground">How would you like paid?</p>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <button
              onClick={() => setDefaultPayoutType("cash")}
              className={cn("px-4 py-1.5 text-sm font-medium", defaultPayoutType === "cash" ? "bg-primary text-primary-foreground" : "bg-background")}
            >
              Cash
            </button>
            <button
              onClick={() => setDefaultPayoutType("credit")}
              className={cn(
                "px-4 py-1.5 text-sm font-medium",
                defaultPayoutType === "credit" ? "bg-primary text-primary-foreground" : "bg-background",
              )}
            >
              Credit
            </button>
          </div>
        </div>

        {checkoutConfig.termsText && (
          <div className="max-w-md text-xs text-muted-foreground">
            <p className="mb-1 font-semibold">Rules</p>
            <p>{checkoutConfig.termsText}</p>
          </div>
        )}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="flex-1 p-4">
        {error && (
          <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {checkoutConfig.checkoutMessage && (
          <p data-testid="checkout-banner" className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            {checkoutConfig.checkoutMessage}
          </p>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setScreen("picker")}>
            Change Game
          </Button>
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search by card name"
            className="max-w-xs"
          />
          <select
            value={setId ?? ""}
            onChange={(e) => {
              setSetId(e.target.value || null);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All sets</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {cards.map((card) => {
            const choice = choiceFor(card.id);
            const price = priceByCardId[card.id];
            const pricePending = pendingPriceCardIds.has(card.id);
            const buyable = !pricePending && price && (price.cash > 0 || price.credit > 0);
            return (
              <div key={card.id} className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2 text-xs">
                {card.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.imageUrl} alt={card.name} className="aspect-[5/7] w-full rounded object-cover" />
                ) : (
                  <div className="flex aspect-[5/7] w-full items-center justify-center rounded bg-muted text-muted-foreground">No image</div>
                )}
                <p className="truncate font-medium text-foreground" title={card.name}>
                  {card.name}
                </p>
                <p className="truncate text-muted-foreground">{card.setName ?? " "}</p>

                <div className="grid grid-cols-3 gap-1">
                  <select
                    value={choice.condition}
                    onChange={(e) => updateChoice(card, "condition", e.target.value)}
                    className="h-7 rounded border border-input bg-background px-1"
                    aria-label={`Condition for ${card.name}`}
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={choice.printing}
                    onChange={(e) => updateChoice(card, "printing", e.target.value)}
                    className="h-7 rounded border border-input bg-background px-1"
                    aria-label={`Printing for ${card.name}`}
                  >
                    {PRINTINGS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <select
                    value={choice.language}
                    onChange={(e) => updateChoice(card, "language", e.target.value)}
                    className="h-7 rounded border border-input bg-background px-1"
                    aria-label={`Language for ${card.name}`}
                  >
                    <option value="EN">EN</option>
                    <option value="JP">JP</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <p>
                  Cash: ${price ? dollars(price.cash) : "-.--"} / Credit: ${price ? dollars(price.credit) : "-.--"}
                </p>

                <Button size="sm" disabled={!buyable} onClick={() => addToCart(card)}>
                  {pricePending ? "Updating price..." : buyable ? "Add to Buylist" : "Not currently buying"}
                </Button>
              </div>
            );
          })}
          {cards.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No cards found.</p>}
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>

      <aside className="flex w-full flex-col gap-3 border-t border-border bg-card p-4 lg:w-96 lg:border-l lg:border-t-0">
        <div>
          <h2 className="text-sm font-semibold">Your Buylist</h2>
          <p className="text-xs text-muted-foreground">
            Unique items: {cart.length} — Total qty: {cart.reduce((s, l) => s + l.quantity, 0)}
          </p>
          <p className="text-xs text-muted-foreground">
            Cash: ${dollars(cartCashTotalCents)} — Credit: ${dollars(cartCreditTotalCents)}
          </p>
        </div>

        <ul data-testid="portal-cart" className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {cart.map((line) => {
            const key = lineKey(line);
            return (
              <li key={key} data-testid="portal-cart-line" className="rounded-md border border-border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium text-foreground">{line.cardName}</p>
                  <button onClick={() => removeLine(key)} className="text-destructive" aria-label={`Remove ${line.cardName}`}>
                    Remove
                  </button>
                </div>
                <p className="text-muted-foreground">
                  {line.condition} · {line.printing} · {line.language}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <label>
                    Qty
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => updateLine(key, { quantity: Math.max(1, Number(e.target.value)) })}
                      className="ml-1 w-14 rounded border border-input bg-background px-1"
                    />
                  </label>
                  <select
                    value={line.payoutType}
                    onChange={(e) => updateLine(key, { payoutType: e.target.value as PayoutType })}
                    className="h-7 rounded border border-input bg-background px-1"
                    aria-label={`Payout type for ${line.cardName}`}
                  >
                    <option value="cash">Cash</option>
                    <option value="credit">Credit</option>
                  </select>
                  <span className="ml-auto font-medium text-foreground">${dollars(unitPriceFor(line) * line.quantity)}</span>
                </div>
                <input
                  value={line.notes}
                  onChange={(e) => updateLine(key, { notes: e.target.value })}
                  placeholder="Notes (optional)"
                  className="mt-1 w-full rounded border border-input bg-background px-1 py-0.5 text-xs"
                />
              </li>
            );
          })}
          {cart.length === 0 && <li className="text-sm text-muted-foreground">Your cart is empty.</li>}
        </ul>

        <p data-testid="portal-total" className="text-sm font-semibold">
          Total offer: ${dollars(cartTotalCents)}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => syncCart([])} disabled={cart.length === 0}>
            Clear Buylist
          </Button>
          <Button variant="outline" size="sm" onClick={exportCartCsv} disabled={cart.length === 0}>
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => syncCart(cart.map((l) => ({ ...l, payoutType: "cash" })))} disabled={cart.length === 0}>
            All Cash
          </Button>
          <Button variant="outline" size="sm" onClick={() => syncCart(cart.map((l) => ({ ...l, payoutType: "credit" })))} disabled={cart.length === 0}>
            All Credit
          </Button>
        </div>
        <Button onClick={() => setCheckoutOpen(true)} disabled={cart.length === 0}>
          Proceed to Checkout
        </Button>
      </aside>

      {checkoutOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50 p-4" role="dialog" aria-label="Checkout">
          <div className="flex max-h-full w-full max-w-md flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Checkout</h2>
            {checkoutConfig.checkoutMessage && <p className="text-sm text-muted-foreground">{checkoutConfig.checkoutMessage}</p>}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portalName">Name</Label>
              <Input id="portalName" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portalEmail">Email</Label>
              <Input id="portalEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portalPhone">Phone Number</Label>
              <Input id="portalPhone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>

            {checkoutConfig.dropInEnabled && checkoutConfig.deliveryEnabled && (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">Are you delivering these cards, or dropping them off in-person?</p>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={fulfillmentMethod === "drop_in"}
                      onChange={() => setFulfillmentMethod("drop_in")}
                    />
                    Drop In
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={fulfillmentMethod === "delivery"}
                      onChange={() => setFulfillmentMethod("delivery")}
                    />
                    Delivery
                  </label>
                </div>
              </div>
            )}

            {fulfillmentMethod === "drop_in" && checkoutConfig.dropInMessage && (
              <p data-testid="fulfillment-message" className="text-xs text-muted-foreground">
                {checkoutConfig.dropInMessage}
              </p>
            )}
            {fulfillmentMethod === "delivery" && checkoutConfig.deliveryMessage && (
              <p data-testid="fulfillment-message" className="text-xs text-muted-foreground">
                {checkoutConfig.deliveryMessage}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="paymentAccount">Payment Account</Label>
              <Input
                id="paymentAccount"
                value={paymentAccount}
                onChange={(e) => setPaymentAccount(e.target.value)}
                placeholder="e.g. PayPal email, or leave blank"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="orderNotes">Order Notes</Label>
              <Textarea id="orderNotes" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
            </div>

            {checkoutConfig.addressAcknowledgmentMessage && (
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={addressAck} onChange={(e) => setAddressAck(e.target.checked)} className="mt-0.5" />
                {checkoutConfig.addressAcknowledgmentMessage}
              </label>
            )}

            {checkoutConfig.termsText && (
              <div data-testid="checkout-terms" className="text-xs text-muted-foreground">
                <p>{checkoutConfig.termsText}</p>
                {checkoutConfig.requireTermsAcceptance && (
                  <label className="mt-1 flex items-center gap-2">
                    <input
                      id="acceptedTerms"
                      type="checkbox"
                      checked={acceptedTerms}
                      onChange={(e) => setAcceptedTerms(e.target.checked)}
                    />
                    I accept the terms above
                  </label>
                )}
              </div>
            )}

            <div className="mt-2 flex justify-between gap-2">
              <Button variant="outline" onClick={() => setCheckoutOpen(false)}>
                Back to Cart
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  busy ||
                  (checkoutConfig.requireTermsAcceptance && !acceptedTerms) ||
                  (!!checkoutConfig.addressAcknowledgmentMessage && !addressAck)
                }
              >
                {busy ? "Submitting..." : "Submit Order"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
