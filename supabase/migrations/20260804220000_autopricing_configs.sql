-- Autopricing Phase 1 (SortSwift parity, foundation): per-game autopricing
-- "configurations", replacing the mental model of one flat store-wide rule
-- list with SortSwift's actual shape -- one named configuration per game,
-- with a price-source fallback chain (mirroring buylist's), a rounding
-- rule, and a "day to run" scheduling field (the field is stored here;
-- actually running on a schedule is a later phase, same as this project's
-- usual incremental build order).
--
-- Deliberately a NEW, separate system alongside the existing flat
-- `pricing_rules` table/`replace_pricing_rules` RPC/`applyAutopricing`
-- action -- those keep working exactly as before. Wiring "Run Autopricing"
-- to use configs instead is a follow-up phase, not this one.
--
-- Price-modifier and condition-modifier columns are included now (each
-- defaulted to sensible identity/SortSwift-matching values) even though
-- their own dedicated tabs aren't built yet, because the live Price Preview
-- calculator (this phase) needs real values to fold into its step-by-step
-- trace -- adding them later would mean either a second migration or the
-- preview lying about steps that don't exist yet.

create table public.autopricing_configs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  game_id uuid not null references public.games(id),
  name text not null,

  -- Price-source fallback chain, same market/low/high/mid vocabulary as
  -- buylist_price_source_config -- duplicated rather than shared, matching
  -- this project's established boundary between buy-side and sell-side
  -- pricing concepts (see buylist-pricing.ts's own priceSourceSchema).
  primary_source text not null default 'market' check (primary_source in ('market', 'low', 'high', 'mid')),
  secondary_source text check (secondary_source in ('market', 'low', 'high', 'mid')),
  last_call_source text check (last_call_source in ('market', 'low', 'high', 'mid')),
  doomsday_source text check (doomsday_source in ('market', 'low', 'high', 'mid')),

  -- "None" walks the chain in order (first source with a price wins);
  -- "lowest"/"highest" instead compares every source that actually has a
  -- price and picks the min/max, ignoring chain order.
  price_selection_rule text not null default 'none' check (price_selection_rule in ('none', 'lowest', 'highest')),

  -- Null = no rounding. Cents so it composes with the rest of this
  -- project's integer-money convention (e.g. 10 = round to $0.10).
  rounding_increment_cents integer check (rounding_increment_cents is null or rounding_increment_cents > 0),

  -- Percent modifier applied at whichever chain link actually resolved the
  -- starting price (same "modifier travels with its source" behavior as
  -- buylist's resolveStartingPriceCents).
  primary_modifier_pct numeric not null default 0,
  secondary_modifier_pct numeric not null default 0,
  last_call_modifier_pct numeric not null default 0,
  doomsday_modifier_pct numeric not null default 0,

  -- Condition modifier %, defaulted to the exact values shown in the
  -- reference product's own demo data.
  nm_modifier_pct numeric not null default 100,
  lp_modifier_pct numeric not null default 99,
  mp_modifier_pct numeric not null default 90,
  hp_modifier_pct numeric not null default 80,
  dmg_modifier_pct numeric not null default 70,

  -- Scheduling field only -- no cron wiring yet, see header comment.
  reprice_day_of_week text check (reprice_day_of_week in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  last_repriced_at timestamptz,
  next_reprice_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index autopricing_configs_store_id_idx on public.autopricing_configs(store_id);
create index autopricing_configs_game_id_idx on public.autopricing_configs(game_id);

create trigger autopricing_configs_set_updated_at
before update on public.autopricing_configs
for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.autopricing_configs to authenticated;
grant select, insert, update, delete on public.autopricing_configs to service_role;

alter table public.autopricing_configs enable row level security;

create policy autopricing_configs_select on public.autopricing_configs
  for select using (public.is_store_member(store_id));
create policy autopricing_configs_insert on public.autopricing_configs
  for insert with check (public.is_store_member(store_id));
create policy autopricing_configs_update on public.autopricing_configs
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));
create policy autopricing_configs_delete on public.autopricing_configs
  for delete using (public.is_store_member(store_id));
