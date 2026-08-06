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
  const q = searchParams.get("q");
  const status = searchParams.get("status");
  const game = searchParams.get("game");

  const template = resolveTemplate(templateId, fields);
  if (!template) {
    return NextResponse.json({ error: `Unknown template or empty fields list` }, { status: 400 });
  }

  let query = supabase
    .from("inventory_items")
    .select(
      "id, quantity, condition, price_cents, notes, status, cards!inner(name, collector_number, rarity, image_url, game_id, sets(name), games(code))",
    )
    .order("created_at", { ascending: false })
    .order("id")
    .limit(1000);

  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("cards.name", `%${q}%`);

  if (game) {
    const { data: gameRow } = await supabase.from("games").select("id").eq("code", game).single();
    if (gameRow) query = query.eq("cards.game_id", gameRow.id as string);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    quantity: number;
    condition: string;
    price_cents: number | null;
    notes: string | null;
    status: string;
    cards: {
      name: string;
      collector_number: string | null;
      rarity: string | null;
      image_url: string | null;
      sets: { name: string } | null;
      games: { code: string } | null;
    };
  };

  const rows: ExportRow[] = ((data ?? []) as unknown as Row[]).map((item) => ({
    id: item.id,
    quantity: item.quantity,
    condition: item.condition,
    price_cents: item.price_cents,
    notes: item.notes,
    status: item.status,
    card_name: item.cards.name,
    set_name: item.cards.sets?.name ?? null,
    collector_number: item.cards.collector_number,
    rarity: item.cards.rarity,
    game_code: item.cards.games?.code ?? null,
    image_url: item.cards.image_url,
  }));

  const csv = buildCsv(template, rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventory-${template.id}.csv"`,
    },
  });
}
