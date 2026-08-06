import { createClient } from "@/lib/supabase/server";
import { getActiveGamesQuery } from "@/lib/games";
import { BuyTerminal } from "./buy-terminal";

export default async function PosBuyPage() {
  const supabase = await createClient();
  const games = await getActiveGamesQuery(supabase);

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-foreground">Buy from customer</h1>
      <BuyTerminal games={games} />
    </main>
  );
}
