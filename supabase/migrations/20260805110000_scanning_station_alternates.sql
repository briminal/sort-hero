-- Scanning parity pass, phase 2 (detail/review panel): powers the "Same
-- Name Alternates" list -- every printing of an exact card name across all
-- sets for the game, so an operator can re-pick the correct set/printing
-- when OCR got the name right but the trigram match picked the wrong set.
create or replace function public.list_card_alternates(p_game_code text, p_name text)
returns table (
  id uuid,
  name text,
  set_name text,
  set_code text,
  collector_number text,
  image_url text,
  rarity text
)
language sql
stable
as $$
  select
    c.id,
    c.name,
    s.name as set_name,
    s.code as set_code,
    c.collector_number,
    c.image_url,
    c.rarity
  from public.cards c
  join public.games g on g.id = c.game_id
  left join public.sets s on s.id = c.set_id
  where g.code = p_game_code
    and c.name = p_name
  order by s.released_at desc nulls last, c.name;
$$;

grant execute on function public.list_card_alternates(text, text) to authenticated;
