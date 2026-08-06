-- Inventory items (seeded by Card Scanning; Inventory module extends this
-- with full CRUD/bulk-ops UI later) and a trigram-ranked card search RPC.

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  card_id uuid not null references public.cards(id),
  scanned_image_url text,
  quantity integer not null default 1,
  status text not null default 'staged' check (status in ('staged', 'confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inventory_items_store_id_idx on public.inventory_items(store_id);
create index inventory_items_card_id_idx on public.inventory_items(card_id);

create trigger inventory_items_set_updated_at
before update on public.inventory_items
for each row execute function public.set_updated_at();

-- service_role needs base table grants too (RLS bypass via BYPASSRLS is a
-- separate check from the table GRANT itself) in case a trusted server-side
-- path ever needs to write here directly.
grant select, insert, update, delete on public.inventory_items to authenticated;
grant select, insert, update, delete on public.inventory_items to service_role;

alter table public.inventory_items enable row level security;

-- Reuses the is_store_member/is_store_owner helpers from the Auth & Stores
-- migration rather than duplicating that membership-check logic.
create policy inventory_items_select on public.inventory_items
  for select
  using (public.is_store_member(store_id));

create policy inventory_items_insert on public.inventory_items
  for insert
  with check (public.is_store_member(store_id));

create policy inventory_items_update on public.inventory_items
  for update
  using (public.is_store_member(store_id))
  with check (public.is_store_member(store_id));

create policy inventory_items_delete on public.inventory_items
  for delete
  using (public.is_store_owner(store_id));

-- Trigram-ranked fuzzy card search, scoped to one game, for OCR text from
-- Card Scanning to match against. No SECURITY DEFINER needed -- cards
-- already has a public select policy, so the caller's own grant suffices.
create function public.search_cards(p_game_code text, p_query text, p_limit int default 5)
returns table (
  id uuid,
  name text,
  set_name text,
  collector_number text,
  image_url text,
  rarity text,
  score real
)
language sql
stable
as $$
  select
    c.id,
    c.name,
    s.name as set_name,
    c.collector_number,
    c.image_url,
    c.rarity,
    similarity(c.name, p_query) as score
  from public.cards c
  join public.games g on g.id = c.game_id
  left join public.sets s on s.id = c.set_id
  where g.code = p_game_code
    and c.name % p_query
  order by score desc
  limit p_limit;
$$;

grant execute on function public.search_cards(text, text, int) to authenticated;
