"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getKioskFilters, searchKioskInventory } from "./actions";
import type { KioskInventoryRow } from "@/lib/kiosk/inventory";
import type { ActiveGame } from "@/lib/games";
import { useKioskCart } from "@/hooks/use-kiosk-cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 24;

const selectClassName =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function dollars(cents: number | null) {
  return cents === null ? "—" : `$${(cents / 100).toFixed(2)}`;
}

type Product = {
  cardId: string;
  cardName: string;
  setName: string | null;
  imageUrl: string | null;
  rarity: string | null;
  variants: KioskInventoryRow[];
};

function groupIntoProducts(rows: KioskInventoryRow[]): Product[] {
  const byCard = new Map<string, Product>();
  for (const row of rows) {
    let product = byCard.get(row.cardId);
    if (!product) {
      product = { cardId: row.cardId, cardName: row.cardName, setName: row.setName, imageUrl: row.imageUrl, rarity: row.rarity, variants: [] };
      byCard.set(row.cardId, product);
    }
    product.variants.push(row);
  }
  return [...byCard.values()];
}

export function KioskBrowser({ storeSlug, games }: { storeSlug: string; games: ActiveGame[] }) {
  const [gameCode, setGameCode] = useState<string>("");
  const [setId, setSetId] = useState("");
  const [rarity, setRarity] = useState("");
  const [sort, setSort] = useState<"name_asc" | "price_asc" | "price_desc">("name_asc");
  const [query, setQuery] = useState("");
  const [sets, setSets] = useState<{ id: string; name: string }[]>([]);
  const [rarities, setRarities] = useState<string[]>([]);
  const [items, setItems] = useState<KioskInventoryRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>({});
  const [cart, setCart] = useKioskCart(storeSlug);

  const requestId = useRef(0);

  useEffect(() => {
    getKioskFilters({ storeSlug, gameCode: gameCode || undefined }).then((result) => {
      if ("sets" in result) {
        setSets(result.sets);
        setRarities(result.rarities);
      }
    });
  }, [storeSlug, gameCode]);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    const timeout = setTimeout(async () => {
      const result = await searchKioskInventory({
        storeSlug,
        gameCode: gameCode || undefined,
        query: query.trim() || undefined,
        setId: setId || undefined,
        rarity: rarity || undefined,
        sort,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (id !== requestId.current) return;

      setLoading(false);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setItems(result);
      setOffset(result.length);
      setHasMore(result.length === PAGE_SIZE);
    }, 300);

    return () => clearTimeout(timeout);
  }, [storeSlug, gameCode, query, setId, rarity, sort]);

  async function loadMore() {
    const id = requestId.current;
    setLoading(true);
    const result = await searchKioskInventory({
      storeSlug,
      gameCode: gameCode || undefined,
      query: query.trim() || undefined,
      setId: setId || undefined,
      rarity: rarity || undefined,
      sort,
      limit: PAGE_SIZE,
      offset,
    });
    if (id !== requestId.current) return;

    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setItems((prev) => [...prev, ...result]);
    setOffset((prev) => prev + result.length);
    setHasMore(result.length === PAGE_SIZE);
  }

  function clearAllFilters() {
    setGameCode("");
    setSetId("");
    setRarity("");
    setSort("name_asc");
    setQuery("");
  }

  const products = useMemo(() => groupIntoProducts(items), [items]);

  function variantFor(product: Product): KioskInventoryRow {
    const selectedId = selectedVariant[product.cardId];
    return product.variants.find((v) => v.inventoryItemId === selectedId) ?? product.variants[0]!;
  }

  function addToCart(product: Product) {
    const variant = variantFor(product);
    const existing = cart.find((l) => l.inventoryItemId === variant.inventoryItemId);
    if (existing) {
      setCart(
        cart.map((l) =>
          l.inventoryItemId === variant.inventoryItemId ? { ...l, quantity: Math.min(l.quantity + 1, variant.quantity) } : l,
        ),
      );
      return;
    }
    setCart([
      ...cart,
      {
        inventoryItemId: variant.inventoryItemId,
        cardId: product.cardId,
        cardName: product.cardName,
        setName: product.setName,
        imageUrl: product.imageUrl,
        condition: variant.condition,
        printing: variant.printing,
        quantity: 1,
        priceCents: variant.priceCents ?? 0,
        maxQuantity: variant.quantity,
      },
    ]);
  }

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {filtersOpen && (
        <aside className="w-full shrink-0 border-b border-border p-4 lg:w-64 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Filters</h2>
            <button type="button" onClick={clearAllFilters} className="text-xs text-primary hover:underline">
              Clear All
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="kiosk-sort" className="text-xs font-medium text-muted-foreground">
                Sort By
              </label>
              <select id="kiosk-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={selectClassName}>
                <option value="name_asc">Name A→Z</option>
                <option value="price_asc">Price ↑</option>
                <option value="price_desc">Price ↓</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="kiosk-game-filter" className="text-xs font-medium text-muted-foreground">
                Game
              </label>
              <select
                id="kiosk-game-filter"
                value={gameCode}
                onChange={(e) => {
                  setGameCode(e.target.value);
                  setSetId("");
                  setRarity("");
                }}
                className={selectClassName}
              >
                <option value="">All games</option>
                {games.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="kiosk-set-filter" className="text-xs font-medium text-muted-foreground">
                Set
              </label>
              <select id="kiosk-set-filter" value={setId} onChange={(e) => setSetId(e.target.value)} className={selectClassName}>
                <option value="">Select Set</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="kiosk-rarity-filter" className="text-xs font-medium text-muted-foreground">
                Rarity
              </label>
              <select id="kiosk-rarity-filter" value={rarity} onChange={(e) => setRarity(e.target.value)} className={selectClassName}>
                <option value="">Any</option>
                {rarities.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </aside>
      )}

      <div className="flex-1 p-4">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="button" variant="outline" size="sm" onClick={() => setFiltersOpen((v) => !v)} className="self-start">
            {filtersOpen ? "Hide Filters" : "Show Filters"}
          </Button>
          <label htmlFor="kiosk-search" className="sr-only">
            Search card name
          </label>
          <Input
            id="kiosk-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products..."
            className="flex-1"
          />
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {!loading && <p className="mb-3 text-sm text-muted-foreground">Showing {products.length} of {products.length} products</p>}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {products.map((product) => {
            const variant = variantFor(product);
            return (
              <div key={product.cardId} className="rounded-lg border border-border bg-card p-3">
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.imageUrl} alt={product.cardName} loading="lazy" className="mb-2 aspect-[5/7] w-full rounded object-cover" />
                ) : (
                  <div className="mb-2 flex aspect-[5/7] w-full items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                    No image
                  </div>
                )}
                <p className="truncate text-sm font-medium text-foreground">{product.cardName}</p>
                <p className="truncate text-xs text-muted-foreground">{product.setName ?? "Unknown set"}</p>

                <select
                  value={variant.inventoryItemId}
                  onChange={(e) => setSelectedVariant((prev) => ({ ...prev, [product.cardId]: e.target.value }))}
                  aria-label={`Variant for ${product.cardName}`}
                  className={`${selectClassName} mt-1.5 h-8 text-xs`}
                >
                  {product.variants.map((v) => (
                    <option key={v.inventoryItemId} value={v.inventoryItemId}>
                      {v.condition} / {v.printing === "foil" ? "Foil" : "Normal"} — {dollars(v.priceCents)} ({v.quantity} left)
                    </option>
                  ))}
                </select>

                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{dollars(variant.priceCents)}</span>
                  <Button type="button" size="sm" onClick={() => addToCart(product)} aria-label={`Add ${product.cardName} to cart`}>
                    Add
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {!loading && products.length === 0 && !error && (
          <p className="mt-8 text-center text-sm text-muted-foreground">No cards found.</p>
        )}

        {hasMore && products.length > 0 && (
          <div className="mt-6 flex justify-center">
            <Button type="button" variant="outline" onClick={loadMore} disabled={loading}>
              {loading ? "Loading..." : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
