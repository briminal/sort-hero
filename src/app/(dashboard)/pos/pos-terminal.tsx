"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Terminal } from "@stripe/terminal-js";
import { createClient } from "@/lib/supabase/client";
import {
  completeCashPayment,
  completeStoreCreditPayment,
  confirmCardPayment,
  createConnectionToken,
  createOrder,
  createPaymentIntent,
  getKioskReservationForPos,
  listPendingKioskReservations,
  searchBuylistCustomers,
  searchInventoryForSale,
  type BuylistCustomerSearchResult,
  type PendingReservation,
  type ReservationForPos,
  type SaleSearchResult,
} from "./actions";
import { completeKioskReservation } from "../settings/kiosk/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InventoryCartLine = {
  kind: "inventory";
  key: string;
  inventoryItemId: string;
  cardName: string;
  condition: string;
  printing: string;
  unitPriceCents: number;
  quantity: number;
  maxQuantity: number;
  taxable: boolean;
  deductInventory: boolean;
};

type CustomCartLine = {
  kind: "custom";
  key: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  taxable: boolean;
};

type CartLine = InventoryCartLine | CustomCartLine;

type CartTab = {
  id: string;
  name: string;
  cart: CartLine[];
  discountInput: string;
  taxExempt: boolean;
};

type Stage = "cart" | "paying" | "done";

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function lineTotalCents(line: CartLine) {
  return line.unitPriceCents * line.quantity;
}

function reservationLinesToCart(lines: ReservationForPos[]): CartLine[] {
  return lines
    .filter((line) => line.maxQuantity > 0)
    .map((line) => ({
      kind: "inventory" as const,
      key: line.id,
      inventoryItemId: line.id,
      cardName: line.cardName,
      condition: "",
      printing: "",
      unitPriceCents: line.unitPriceCents,
      quantity: Math.min(line.quantity, line.maxQuantity),
      maxQuantity: line.maxQuantity,
      taxable: true,
      deductInventory: true,
    }));
}

function newCartTab(name: string, cart: CartLine[] = []): CartTab {
  return { id: `cart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, cart, discountInput: "0", taxExempt: false };
}

/** Groups flat search results (one row per inventory item) into one tile per
 * card -- SortSwift's catalog shows a single product tile per card and only
 * asks staff to pick a variant (condition/printing) when more than one is in
 * stock, rather than listing every inventory row as its own result. */
function groupByCard(results: SaleSearchResult[]): { cardId: string; cardName: string; setName: string | null; imageUrl: string | null; variants: SaleSearchResult[] }[] {
  const groups = new Map<string, { cardId: string; cardName: string; setName: string | null; imageUrl: string | null; variants: SaleSearchResult[] }>();
  for (const r of results) {
    const existing = groups.get(r.cardId);
    if (existing) {
      existing.variants.push(r);
    } else {
      groups.set(r.cardId, { cardId: r.cardId, cardName: r.cardName, setName: r.setName, imageUrl: r.imageUrl, variants: [r] });
    }
  }
  return Array.from(groups.values());
}

export function PosTerminal({
  tillId,
  tillName,
  taxRatePercent,
  storeId,
}: {
  tillId: string;
  tillName: string;
  taxRatePercent: number;
  storeId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SaleSearchResult[]>([]);
  const [variantPickerCardId, setVariantPickerCardId] = useState<string | null>(null);
  const [firstTab] = useState<CartTab>(() => newCartTab("Cart 1"));
  const [tabs, setTabs] = useState<CartTab[]>(() => [firstTab]);
  const [activeTabId, setActiveTabId] = useState(() => firstTab.id);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [customItemOpen, setCustomItemOpen] = useState(false);
  const [customItemName, setCustomItemName] = useState("");
  const [customItemPrice, setCustomItemPrice] = useState("0");
  const [reservations, setReservations] = useState<PendingReservation[]>([]);
  const [reservedPanelOpen, setReservedPanelOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("cart");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderTotalCents, setOrderTotalCents] = useState(0);
  const [cashAmount, setCashAmount] = useState("0");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<BuylistCustomerSearchResult[]>([]);
  const [storeCreditCustomer, setStoreCreditCustomer] = useState<BuylistCustomerSearchResult | null>(null);
  const [storeCreditAmount, setStoreCreditAmount] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [completedOrderId, setCompletedOrderId] = useState<string | null>(null);

  const terminalRef = useRef<Terminal | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? firstTab;
  const cart = activeTab.cart;
  const discountInput = activeTab.discountInput;
  const taxExempt = activeTab.taxExempt;

  const cartSubtotalCents = cart.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const groupedResults = groupByCard(results);
  const cartDiscountCents = Math.min(Math.round(Number(discountInput) * 100) || 0, cartSubtotalCents);
  const taxableSubtotalCents = cart.filter((l) => l.taxable).reduce((sum, l) => sum + lineTotalCents(l), 0);
  const cartTaxCents = taxExempt ? 0 : Math.round(taxableSubtotalCents * (taxRatePercent / 100));
  const cartTotalCents = cartSubtotalCents - cartDiscountCents + cartTaxCents;

  function updateTab(tabId: string, updater: (tab: CartTab) => CartTab) {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? updater(t) : t)));
  }

  function updateActiveTab(updater: (tab: CartTab) => CartTab) {
    updateTab(activeTabId, updater);
  }

  function setCart(updater: (cart: CartLine[]) => CartLine[]) {
    updateActiveTab((t) => ({ ...t, cart: updater(t.cart) }));
  }

  function addNewCart() {
    const tab = newCartTab(`Cart ${tabs.length + 1}`);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function removeCart(tabId: string) {
    if (tabs.length <= 1) return;
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId && next[0]) setActiveTabId(next[0].id);
      return next;
    });
  }

  function renameCart(tabId: string, name: string) {
    updateTab(tabId, (t) => ({ ...t, name: name.trim() || t.name }));
  }

  // Live "Reserved" list -- pending kiosk reservations for this store, so
  // staff see a customer's kiosk checkout appear automatically instead of
  // having to go find it in Kiosk Settings first. Realtime, not polling,
  // per CLAUDE.md.
  useEffect(() => {
    listPendingKioskReservations().then((result) => {
      if (Array.isArray(result)) setReservations(result);
    });

    const supabase = createClient();
    const channel = supabase
      .channel(`pos-reservations-${storeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kiosk_reservations", filter: `store_id=eq.${storeId}` },
        () => {
          listPendingKioskReservations().then((result) => {
            if (Array.isArray(result)) setReservations(result);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeId]);

  async function loadReservationIntoNewCart(reservation: PendingReservation) {
    const result = await getKioskReservationForPos(reservation.id);
    if (!Array.isArray(result)) {
      setError(result.error);
      return;
    }
    const tab = newCartTab(reservation.customerNameOrPhone, reservationLinesToCart(result));
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setReservedPanelOpen(false);

    // Marks it handled so it drops off every staff screen's Reserved list --
    // the realtime subscription above then removes it here too.
    await completeKioskReservation({ reservationId: reservation.id });
  }

  // Legacy single-reservation handoff from the Kiosk Settings "Load into
  // POS" link (?reservation=<id>) -- loads it into a new cart tab the same
  // way the live Reserved list does, then strips the param.
  useEffect(() => {
    const reservationId = searchParams.get("reservation");
    if (!reservationId) return;

    getKioskReservationForPos(reservationId).then((result) => {
      if (!Array.isArray(result)) {
        setError(result.error);
        return;
      }
      const tab = newCartTab("Reserved sale", reservationLinesToCart(result));
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    });

    const params = new URLSearchParams(searchParams.toString());
    params.delete("reservation");
    router.replace(`/pos${params.toString() ? `?${params.toString()}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    const result = await searchInventoryForSale(value);
    if (Array.isArray(result)) setResults(result);
  }

  function addToCart(item: SaleSearchResult) {
    if (item.priceCents === null) {
      setError(`${item.cardName} has no price set -- cannot sell it yet.`);
      return;
    }
    setError(null);
    setVariantPickerCardId(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.kind === "inventory" && l.inventoryItemId === item.id);
      if (existing && existing.kind === "inventory") {
        if (existing.quantity >= existing.maxQuantity) return prev;
        return prev.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      const newLine: InventoryCartLine = {
        kind: "inventory",
        key: item.id,
        inventoryItemId: item.id,
        cardName: item.cardName,
        condition: item.condition,
        printing: item.printing,
        unitPriceCents: item.priceCents!,
        quantity: 1,
        maxQuantity: item.quantity,
        taxable: true,
        deductInventory: true,
      };
      return [...prev, newLine];
    });
  }

  function addCustomItem() {
    const priceCents = Math.round(Number(customItemPrice) * 100) || 0;
    if (!customItemName.trim()) {
      setError("Custom item needs a name.");
      return;
    }
    setError(null);
    setCart((prev) => [
      ...prev,
      { kind: "custom", key: `custom-${Date.now()}`, name: customItemName.trim(), unitPriceCents: priceCents, quantity: 1, taxable: true },
    ]);
    setCustomItemName("");
    setCustomItemPrice("0");
    setCustomItemOpen(false);
  }

  function updateQuantity(key: string, quantity: number) {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.key !== key) return l;
          const max = l.kind === "inventory" ? l.maxQuantity : 999;
          return { ...l, quantity: Math.max(0, Math.min(max, quantity)) };
        })
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function toggleLineTaxable(key: string) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, taxable: !l.taxable } : l)));
  }

  function toggleLineDeductInventory(key: string) {
    setCart((prev) =>
      prev.map((l) => (l.key === key && l.kind === "inventory" ? { ...l, deductInventory: !l.deductInventory } : l)),
    );
  }

  async function handleCustomerSearch(value: string) {
    setCustomerQuery(value);
    if (value.trim().length < 2) {
      setCustomerResults([]);
      return;
    }
    const result = await searchBuylistCustomers(value);
    if (Array.isArray(result)) setCustomerResults(result);
  }

  async function getTerminal(): Promise<Terminal> {
    if (terminalRef.current) return terminalRef.current;

    const { loadStripeTerminal } = await import("@stripe/terminal-js");
    const StripeTerminal = await loadStripeTerminal();
    if (!StripeTerminal) throw new Error("Could not load Stripe Terminal");

    const terminal = StripeTerminal.create({
      onFetchConnectionToken: async () => {
        const result = await createConnectionToken();
        if ("error" in result) throw new Error(result.error);
        return result.secret;
      },
      onUnexpectedReaderDisconnect: () => {
        terminalRef.current = null;
      },
    });

    const discoverResult = await terminal.discoverReaders({ simulated: true });
    if ("error" in discoverResult) throw new Error(String(discoverResult.error));
    const reader = discoverResult.discoveredReaders[0];
    if (!reader) throw new Error("No simulated reader found");

    const connectResult = await terminal.connectReader(reader);
    if ("error" in connectResult) throw new Error(connectResult.error.message);

    terminalRef.current = terminal;
    return terminal;
  }

  async function handleCheckout() {
    setError(null);
    const result = await createOrder({
      tillId,
      items: cart
        .filter((l): l is InventoryCartLine => l.kind === "inventory")
        .map((l) => ({
          inventoryItemId: l.inventoryItemId,
          quantity: l.quantity,
          taxable: l.taxable,
          deductInventory: l.deductInventory,
        })),
      customItems: cart
        .filter((l): l is CustomCartLine => l.kind === "custom")
        .map((l) => ({ name: l.name, unitPriceCents: l.unitPriceCents, quantity: l.quantity, taxable: l.taxable })),
      discountCents: cartDiscountCents,
      taxExempt,
    });
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setOrderId(result.orderId);
    setOrderTotalCents(result.totalCents);
    setCashAmount("0");
    setStoreCreditAmount("0");
    setStoreCreditCustomer(null);
    setCustomerQuery("");
    setCustomerResults([]);
    setStage("paying");
  }

  async function handlePay() {
    if (!orderId) return;
    setError(null);
    setProcessing(true);

    try {
      const cashCents = Math.round(Number(cashAmount) * 100) || 0;
      const afterCashCents = orderTotalCents - cashCents;

      if (cashCents > 0) {
        setStatus("Recording cash payment...");
        const cashResult = await completeCashPayment({
          orderId,
          amountCents: Math.min(cashCents, orderTotalCents),
        });
        if ("error" in cashResult) throw new Error(cashResult.error);
        // Mark this leg as already paid immediately -- if a later leg (card)
        // fails and the cashier retries, the amount fields must not resend
        // an already-succeeded payment into the new remaining-balance check.
        setCashAmount("0");
      }

      const storeCreditCents = storeCreditCustomer
        ? Math.min(Math.round(Number(storeCreditAmount) * 100) || 0, afterCashCents)
        : 0;
      const remainingCents = afterCashCents - storeCreditCents;

      if (storeCreditCents > 0 && storeCreditCustomer) {
        setStatus("Redeeming store credit...");
        const creditResult = await completeStoreCreditPayment({
          orderId,
          customerId: storeCreditCustomer.id,
          amountCents: storeCreditCents,
        });
        if ("error" in creditResult) throw new Error(creditResult.error);
        setStoreCreditAmount("0");
      }

      if (remainingCents > 0) {
        setStatus("Connecting to card reader...");
        const terminal = await getTerminal();

        setStatus("Creating payment...");
        const intentResult = await createPaymentIntent({ orderId, amountCents: remainingCents });
        if ("error" in intentResult) throw new Error(intentResult.error);

        setStatus("Collecting card (simulated reader)...");
        const collectResult = await terminal.collectPaymentMethod(intentResult.clientSecret);
        if ("error" in collectResult) throw new Error(collectResult.error.message);

        setStatus("Processing payment...");
        const processResult = await terminal.processPayment(collectResult.paymentIntent);
        if ("error" in processResult) throw new Error(processResult.error.message);

        const confirmResult = await confirmCardPayment({
          orderId,
          paymentIntentId: processResult.paymentIntent.id,
        });
        if ("error" in confirmResult) throw new Error(confirmResult.error);
      }

      setStatus(null);
      setCompletedOrderId(orderId);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setStatus(null);
    } finally {
      setProcessing(false);
    }
  }

  function startNewSale() {
    updateActiveTab((t) => ({ ...t, cart: [], discountInput: "0", taxExempt: false }));
    setCustomItemOpen(false);
    setCustomItemName("");
    setCustomItemPrice("0");
    setVariantPickerCardId(null);
    setOrderId(null);
    setOrderTotalCents(0);
    setCompletedOrderId(null);
    setStage("cart");
    setQuery("");
    setResults([]);
    setStoreCreditCustomer(null);
    setStoreCreditAmount("0");
    setCustomerQuery("");
    setCustomerResults([]);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Till: {tillName}</p>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {status && (
        <p data-testid="pos-status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {status}
        </p>
      )}

      <div data-testid="pos-cart-tabs" className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2">
        {tabs.map((t) => (
          <div key={t.id} className="flex items-center">
            {renamingTabId === t.id ? (
              <Input
                autoFocus
                defaultValue={t.name}
                className="h-8 w-32"
                onBlur={(e) => {
                  renameCart(t.id, e.target.value);
                  setRenamingTabId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            ) : (
              <button
                type="button"
                data-testid="pos-cart-tab"
                data-active={t.id === activeTabId}
                disabled={stage !== "cart"}
                onClick={() => setActiveTabId(t.id)}
                onDoubleClick={() => setRenamingTabId(t.id)}
                className={`rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${
                  t.id === activeTabId ? "border-border bg-card font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.name} ({t.cart.length})
              </button>
            )}
            {tabs.length > 1 && stage === "cart" && (
              <button
                type="button"
                aria-label={`Close ${t.name}`}
                onClick={() => removeCart(t.id)}
                className="-ml-1 px-1 text-xs text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {stage === "cart" && (
          <Button size="sm" variant="ghost" onClick={addNewCart}>
            + New Cart
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          data-testid="pos-reserved-tab"
          className="ml-auto"
          onClick={() => setReservedPanelOpen((v) => !v)}
        >
          Reserved ({reservations.length})
        </Button>
      </div>

      {reservedPanelOpen && (
        <Card>
          <CardHeader>
            <CardTitle>Reserved carts</CardTitle>
          </CardHeader>
          <CardContent>
            {reservations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending kiosk reservations.</p>
            ) : (
              <ul data-testid="pos-reserved-list" className="flex flex-col gap-1.5">
                {reservations.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <span className="text-foreground">
                      {r.customerNameOrPhone} — ${dollars(r.totalCents)}
                    </span>
                    <Button size="sm" onClick={() => loadReservationIntoNewCart(r)}>
                      Load into new cart
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {stage === "cart" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="posSearch">Search cards to sell</Label>
            <Input
              id="posSearch"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Card name"
              className="sm:w-80"
            />
          </div>
          {groupedResults.length > 0 && (
            <div data-testid="pos-search-results" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {groupedResults.map((group) => {
                const singleVariant = group.variants.length === 1 ? group.variants[0] : null;
                const pickingVariant = variantPickerCardId === group.cardId;
                return (
                  <div key={group.cardId} data-testid="pos-catalog-tile" className="flex flex-col gap-2 rounded-md border border-border p-2 text-sm">
                    <div className="flex aspect-[5/7] items-center justify-center overflow-hidden rounded bg-muted">
                      {group.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={group.imageUrl} alt={group.cardName} className="h-full w-full object-cover" />
                      ) : (
                        <span className="px-1 text-center text-xs text-muted-foreground">{group.cardName}</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="line-clamp-2 font-medium text-foreground">{group.cardName}</span>
                      <span className="text-xs text-muted-foreground">{group.setName ?? "—"}</span>
                    </div>
                    {singleVariant ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          {singleVariant.condition} · {singleVariant.printing} · qty {singleVariant.quantity}
                        </span>
                        <Button size="sm" onClick={() => addToCart(singleVariant)} disabled={singleVariant.priceCents === null}>
                          {singleVariant.priceCents !== null ? `Add — $${dollars(singleVariant.priceCents)}` : "No price"}
                        </Button>
                      </>
                    ) : pickingVariant ? (
                      <ul className="flex flex-col gap-1">
                        {group.variants.map((v) => (
                          <li key={v.id}>
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full justify-between"
                              onClick={() => addToCart(v)}
                              disabled={v.priceCents === null}
                            >
                              <span>
                                {v.condition} · {v.printing}
                              </span>
                              <span>{v.priceCents !== null ? `$${dollars(v.priceCents)}` : "no price"}</span>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setVariantPickerCardId(group.cardId)}>
                        Select Variant ({group.variants.length})
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div>
            {!customItemOpen ? (
              <Button size="sm" variant="outline" onClick={() => setCustomItemOpen(true)}>
                Add Custom Item
              </Button>
            ) : (
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="customItemName">Name</Label>
                  <Input id="customItemName" value={customItemName} onChange={(e) => setCustomItemName(e.target.value)} className="h-8 w-48" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="customItemPrice">Price ($)</Label>
                  <Input
                    id="customItemPrice"
                    type="number"
                    min={0}
                    step="0.01"
                    value={customItemPrice}
                    onChange={(e) => setCustomItemPrice(e.target.value)}
                    className="h-8 w-24"
                  />
                </div>
                <Button size="sm" onClick={addCustomItem}>
                  Add to cart
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCustomItemOpen(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{activeTab.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul data-testid="pos-cart" className="flex flex-col gap-1.5">
                {cart.map((line) => {
                  const label = line.kind === "inventory" ? line.cardName : `${line.name} (custom)`;
                  return (
                    <li key={line.key} data-testid="pos-cart-line" className="flex flex-col gap-1 border-b border-border pb-2 text-sm text-foreground">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex-1">
                          {label}
                          {line.kind === "inventory" && line.condition && ` — ${line.condition} · ${line.printing}`} — $
                          {dollars(line.unitPriceCents)} ×
                        </span>
                        <Input
                          type="number"
                          min={0}
                          max={line.kind === "inventory" ? line.maxQuantity : 999}
                          value={line.quantity}
                          onChange={(e) => updateQuantity(line.key, Number(e.target.value))}
                          aria-label={`Quantity for ${label} in cart`}
                          className="h-8 w-20"
                        />
                        <span>= ${dollars(lineTotalCents(line))}</span>
                        <Button size="sm" variant="ghost" onClick={() => removeLine(line.key)}>
                          Remove
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" checked={line.taxable} onChange={() => toggleLineTaxable(line.key)} className="size-3.5 rounded border-input" />
                          Taxable
                        </label>
                        {line.kind === "inventory" && (
                          <label className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={!line.deductInventory}
                              onChange={() => toggleLineDeductInventory(line.key)}
                              className="size-3.5 rounded border-input"
                            />
                            Do not deduct inventory
                          </label>
                        )}
                      </div>
                    </li>
                  );
                })}
                {cart.length === 0 && <li className="text-sm text-muted-foreground">Cart is empty.</li>}
              </ul>

              {cart.length > 0 && (
                <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cartDiscount">Discount ($)</Label>
                    <Input
                      id="cartDiscount"
                      type="number"
                      min={0}
                      step="0.01"
                      value={discountInput}
                      onChange={(e) => updateActiveTab((t) => ({ ...t, discountInput: e.target.value }))}
                      className="h-8 w-24"
                    />
                  </div>
                  <label className="flex items-center gap-1.5 pb-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={taxExempt}
                      onChange={(e) => updateActiveTab((t) => ({ ...t, taxExempt: e.target.checked }))}
                      className="size-4 rounded border-input"
                    />
                    Tax exempt
                  </label>
                </div>
              )}

              <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                <span>Subtotal: ${dollars(cartSubtotalCents)}</span>
                {cartDiscountCents > 0 && <span>Discount: -${dollars(cartDiscountCents)}</span>}
                <span>Tax ({taxExempt ? "exempt" : `${taxRatePercent}%`}): ${dollars(cartTaxCents)}</span>
              </div>
              <p data-testid="pos-cart-total" className="text-lg font-semibold text-foreground">
                Total: ${dollars(cartTotalCents)}
              </p>
              <div>
                <Button onClick={handleCheckout} disabled={cart.length === 0}>
                  Checkout
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {stage === "paying" && orderId && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-4">
            <p data-testid="pos-order-total" className="text-lg font-semibold text-foreground">
              Order total: ${dollars(orderTotalCents)}
            </p>

            <div className="flex flex-col gap-1.5 sm:w-56">
              <Label htmlFor="cashAmount">Cash amount</Label>
              <Input
                id="cashAmount"
                type="number"
                step="0.01"
                min={0}
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
              />
              {(Math.round(Number(cashAmount) * 100) || 0) > orderTotalCents && (
                <p data-testid="pos-change-due" className="text-sm font-medium text-success">
                  Change due: ${dollars((Math.round(Number(cashAmount) * 100) || 0) - orderTotalCents)}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1.5 sm:w-80">
                <Label htmlFor="creditCustomerSearch">Store credit customer (optional)</Label>
                <Input
                  id="creditCustomerSearch"
                  value={customerQuery}
                  onChange={(e) => handleCustomerSearch(e.target.value)}
                  placeholder="Name, email, or phone"
                />
              </div>
              {customerResults.length > 0 && (
                <ul data-testid="pos-customer-results" className="flex flex-col gap-1.5">
                  {customerResults.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                      <span className="text-foreground">
                        {c.name ?? c.email ?? c.phone ?? "Customer"} — balance ${dollars(c.storeCreditBalanceCents)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setStoreCreditCustomer(c);
                          setCustomerResults([]);
                          setCustomerQuery(c.name ?? c.email ?? "");
                        }}
                      >
                        Select
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {storeCreditCustomer && (
                <>
                  <div
                    data-testid="pos-selected-credit-customer"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="text-foreground">
                      Using store credit for {storeCreditCustomer.name ?? storeCreditCustomer.email} (balance $
                      {dollars(storeCreditCustomer.storeCreditBalanceCents)})
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setStoreCreditCustomer(null);
                        setStoreCreditAmount("0");
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                  <div className="flex flex-col gap-1.5 sm:w-56">
                    <Label htmlFor="storeCreditAmount">Store credit amount</Label>
                    <Input
                      id="storeCreditAmount"
                      type="number"
                      step="0.01"
                      min={0}
                      max={storeCreditCustomer.storeCreditBalanceCents / 100}
                      value={storeCreditAmount}
                      onChange={(e) => setStoreCreditAmount(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              Remaining for card: $
              {dollars(
                Math.max(
                  0,
                  orderTotalCents -
                    (Math.round(Number(cashAmount) * 100) || 0) -
                    (storeCreditCustomer ? Math.round(Number(storeCreditAmount) * 100) || 0 : 0),
                ),
              )}
            </p>
            <div>
              <Button onClick={handlePay} disabled={processing}>
                {processing ? "Processing..." : "Pay"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "done" && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-4">
            <Badge variant="success" data-testid="pos-sale-complete">
              Sale complete (order {completedOrderId})
            </Badge>
            <Button onClick={startNewSale}>New sale</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
