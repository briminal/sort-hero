-- Scanning parity pass, phase 1 (foundation): bulk scan rows need to carry
-- printing (normal/foil) and language through to the eventual inventory
-- insert, same convention already established for buylist_items.
alter table public.inventory_items
  add column printing text not null default 'normal' check (printing in ('normal', 'foil')),
  add column language text not null default 'EN';

-- Scan Station's Recognition Configuration has an optional "Expansion"
-- narrower. Postgres treats an added parameter as a distinct overload, not
-- a replacement, even with a default -- create or replace alone would leave
-- the old 3-arg version callable (and ambiguous to PostgREST) alongside the
-- new one, so the old signature is dropped explicitly first, same
-- convention as every other genuine signature change in this project.
drop function if exists public.search_cards(text, text, int);

create or replace function public.search_cards(p_game_code text, p_query text, p_limit int default 5, p_set_id uuid default null)
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
    and (p_set_id is null or c.set_id = p_set_id)
  order by score desc
  limit p_limit;
$$;
