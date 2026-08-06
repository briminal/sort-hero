import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listAutopricingConfigs } from "../actions";
import { ConfigsList, type GameOption } from "./configs-list";

export default async function AutopricingConfigsPage() {
  const supabase = await createClient();
  const { data: gamesData } = await supabase.from("games").select("id, code, name").order("name");
  const games = (gamesData ?? []) as GameOption[];
  const result = await listAutopricingConfigs();

  if ("error" in result) {
    return (
      <main className="p-6">
        <h1 className="text-lg font-semibold">Autopricing configurations</h1>
        <p role="alert" className="mt-2 text-sm text-destructive">
          Could not load configurations: {result.error}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-6">
      <div>
        <Link href="/autopricing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to autopricing
        </Link>
        <h1 className="mt-2 text-lg font-semibold">Autopricing configurations</h1>
        <p className="text-sm text-muted-foreground">
          One configuration per game -- price sources, rounding, and condition/price modifiers, with a live preview.
        </p>
      </div>
      <ConfigsList games={games} initialConfigs={result} />
    </main>
  );
}
