-- Kiosk parity pass, phase 1 (storefront): extends kiosk_browse_inventory
-- with set/rarity/sort filters and surfaces printing/language so the
-- client can group same-card rows into one product tile with a variant
-- (condition/printing) dropdown, matching SortSwift's kiosk. The 5-arg
-- version is a distinct overload in Postgres even with new defaulted
-- params, so it's dropped explicitly first (same convention as every other
-- genuine signature change in this project).
drop function if exists public.kiosk_browse_inventory(uuid, text, text, int, int);

create or replace function public.kiosk_browse_inventory(
  p_store_id uuid,
  p_game_code text default null,
  p_query text default null,
  p_set_id uuid default null,
  p_rarity text default null,
  p_sort text default 'name_asc',
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  inventory_item_id uuid,
  card_id uuid,
  card_name text,
  set_id uuid,
  set_name text,
  rarity text,
  image_url text,
  condition text,
  printing text,
  language text,
  quantity int,
  price_cents int
)
language sql
stable
as $$
  select
    i.id as inventory_item_id,
    c.id as card_id,
    c.name as card_name,
    s.id as set_id,
    s.name as set_name,
    c.rarity,
    c.image_url,
    i.condition,
    i.printing,
    i.language,
    i.quantity,
    i.price_cents
  from public.inventory_items i
  join public.cards c on c.id = i.card_id
  join public.games g on g.id = c.game_id
  left join public.sets s on s.id = c.set_id
  where i.store_id = p_store_id
    and i.status = 'confirmed'
    and i.quantity > 0
    and (p_game_code is null or g.code = p_game_code)
    and (p_query is null or c.name % p_query)
    and (p_set_id is null or c.set_id = p_set_id)
    and (p_rarity is null or c.rarity = p_rarity)
  order by
    case when p_query is not null then similarity(c.name, p_query) end desc nulls last,
    case when p_sort = 'price_asc' then i.price_cents end asc nulls last,
    case when p_sort = 'price_desc' then i.price_cents end desc nulls last,
    c.name,
    i.condition
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.kiosk_browse_inventory(uuid, text, text, uuid, text, text, int, int) to service_role;

-- Powers the filter sidebar's Set/Rarity dropdowns, scoped to what's
-- actually in stock (not the whole catalog) -- listing a set with zero
-- available cards would be a dead-end filter option.
create or replace function public.kiosk_available_filters(p_store_id uuid, p_game_code text default null)
returns table (sets jsonb, rarities jsonb)
language sql
stable
as $$
  select
    (
      select coalesce(jsonb_agg(distinct jsonb_build_object('id', s.id, 'name', s.name)), '[]'::jsonb)
      from public.inventory_items i
      join public.cards c on c.id = i.card_id
      join public.games g on g.id = c.game_id
      join public.sets s on s.id = c.set_id
      where i.store_id = p_store_id and i.status = 'confirmed' and i.quantity > 0
        and (p_game_code is null or g.code = p_game_code)
    ) as sets,
    (
      select coalesce(jsonb_agg(distinct c.rarity), '[]'::jsonb)
      from public.inventory_items i
      join public.cards c on c.id = i.card_id
      join public.games g on g.id = c.game_id
      where i.store_id = p_store_id and i.status = 'confirmed' and i.quantity > 0
        and c.rarity is not null
        and (p_game_code is null or g.code = p_game_code)
    ) as rarities;
$$;

grant execute on function public.kiosk_available_filters(uuid, text) to service_role;
