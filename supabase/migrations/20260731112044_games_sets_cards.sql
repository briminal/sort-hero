-- Card database: games, sets, cards. Public reference data, not tenant-scoped.
-- Bulk-imported by scripts/seed/*.ts, not written to by the app itself.

create extension if not exists pg_trgm;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique
);

insert into public.games (name, code) values
  ('Magic: The Gathering', 'mtg'),
  ('Pokémon', 'pokemon'),
  ('Yu-Gi-Oh!', 'yugioh');

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  external_id text not null,
  name text not null,
  code text,
  released_at date,
  created_at timestamptz not null default now(),
  unique (game_id, external_id)
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  set_id uuid references public.sets(id),
  external_id text not null,
  name text not null,
  collector_number text,
  image_url text,
  rarity text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, external_id)
);

create index cards_name_trgm_idx on public.cards using gin (name gin_trgm_ops);
create index cards_set_id_idx on public.cards(set_id);
create index sets_game_id_idx on public.sets(game_id);

create trigger cards_set_updated_at
before update on public.cards
for each row execute function public.set_updated_at();

-- Public, non-sensitive catalog data: readable by anyone, writable only by
-- the service-role seed scripts (RLS has no insert/update/delete policy for
-- anon/authenticated, so those are denied regardless of table grants).
grant select on public.games to anon, authenticated;
grant select on public.sets to anon, authenticated;
grant select on public.cards to anon, authenticated;

-- service_role has BYPASSRLS, but base table GRANTs are a separate check
-- Postgres enforces before RLS is even evaluated -- the seed scripts need
-- these to upsert. (Same class of gap caught in the stores/store_members
-- migration: RLS policies alone are not table access.)
grant select on public.games to service_role;
grant select, insert, update on public.sets to service_role;
grant select, insert, update on public.cards to service_role;

alter table public.games enable row level security;
alter table public.sets enable row level security;
alter table public.cards enable row level security;

create policy games_select on public.games for select using (true);
create policy sets_select on public.sets for select using (true);
create policy cards_select on public.cards for select using (true);
