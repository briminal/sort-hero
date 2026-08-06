import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCsv } from "@/lib/csv/export";
import { resolveTemplate, type ExportRow } from "@/lib/csv/templates";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const templateId = searchParams.get("template");
  const fields = searchParams.get("fields");
  const ids = searchParams.get("ids");
  const game = searchParams.get("game");
  const set = searchParams.get("set");
  const q = searchParams.get("q");

  const template = resolveTemplate(templateId, fields);
  if (!template) {
    return NextResponse.json({ error: "Unknown template or empty fields list" }, { status: 400 });
  }

  let query = supabase
    .from("cards")
    .select("id, name, collector_number, rarity, image_url, sets(name), games(code)")
    .limit(200);

  if (ids) {
    query = query.in("id", ids.split(","));
  } else {
    if (!game) {
      return NextResponse.json({ error: "game is required when ids is not provided" }, { status: 400 });
    }
    const { data: gameRow } = await supabase.from("games").select("id").eq("code", game).single();
    if (!gameRow) {
      return NextResponse.json({ error: `Unknown game: ${game}` }, { status: 400 });
    }
    query = query.eq("game_id", gameRow.id as string);
    if (set) query = query.eq("set_id", set);
    if (q) query = query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    name: string;
    collector_number: string | null;
    rarity: string | null;
    image_url: string | null;
    sets: { name: string } | null;
    games: { code: string } | null;
  };

  // Blank listing template -- inventory-specific fields are unset since
  // these cards aren't owned yet. Filled in and re-imported via the
  // existing /inventory/import flow.
  const rows: ExportRow[] = ((data ?? []) as unknown as Row[]).map((card) => ({
    id: "",
    quantity: 0,
    condition: "NM",
    price_cents: null,
    notes: null,
    status: "",
    card_name: card.name,
    set_name: card.sets?.name ?? null,
    collector_number: card.collector_number,
    rarity: card.rarity,
    game_code: card.games?.code ?? null,
    image_url: card.image_url,
  }));

  const csv = buildCsv(template, rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="catalog-${template.id}.csv"`,
    },
  });
}
