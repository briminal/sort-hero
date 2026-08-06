import { createClient } from "@/lib/supabase/server";
import { CatalogBrowser, type CatalogCardRow } from "./catalog-browser";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string; set?: string; q?: string }>;
}) {
  const { game = "mtg", set, q } = await searchParams;
  const supabase = await createClient();

  const { data: gameRow } = await supabase.from("games").select("id").eq("code", game).single();
  const gameId = gameRow?.id as string | undefined;

  const { data: sets } = await supabase
    .from("sets")
    .select("id, name")
    .eq("game_id", gameId ?? "")
    .order("name")
    .limit(500);

  let cardsQuery = supabase
    .from("cards")
    .select("id, name, image_url, rarity, collector_number, sets(name)")
    .eq("game_id", gameId ?? "")
    .order("name")
    .limit(200);

  if (set) cardsQuery = cardsQuery.eq("set_id", set);
  if (q) cardsQuery = cardsQuery.ilike("name", `%${q}%`);

  const { data: cards, error } = await cardsQuery;

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-foreground">Browse Catalog</h1>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
      )}
      <CatalogBrowser
        game={game}
        sets={sets ?? []}
        cards={(cards ?? []) as unknown as CatalogCardRow[]}
      />
    </main>
  );
}
