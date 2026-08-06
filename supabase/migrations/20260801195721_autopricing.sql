-- Autopricing: market price cache (populated by seed scripts, same trust
-- boundary as cards/sets) and per-store configurable pricing rules.

create table public.card_market_prices (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) unique,
  source text not null,
  market_price_cents integer,
  low_price_cents integer,
  high_price_cents integer,
  fetched_at timestamptz not null default now()
);

create index card_market_prices_card_id_idx on public.card_market_prices(card_id);

-- Public, non-sensitive catalog-adjacent data: readable by anyone, writable
-- only by the service-role seed scripts -- same pattern as cards/sets.
grant select on public.card_market_prices to anon, authenticated;
grant select, insert, update on public.card_market_prices to service_role;

alter table public.card_market_prices enable row level security;

create policy card_market_prices_select on public.card_market_prices
  for select using (true);

-- Per-store pricing pipeline configuration.
create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  step_order integer not null,
  rule_type text not null check (rule_type in (
    'condition_multiplier', 'margin_percent', 'margin_fixed',
    'round_to_nearest', 'min_price', 'max_price'
  )),
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true
);

create index pricing_rules_store_id_idx on public.pricing_rules(store_id);

grant select, insert, update, delete on public.pricing_rules to authenticated;
grant select, insert, update, delete on public.pricing_rules to service_role;

alter table public.pricing_rules enable row level security;

-- Reuses the is_store_member/is_store_owner helpers from the Auth & Stores
-- migration, same pattern as inventory_items.
create policy pricing_rules_select on public.pricing_rules
  for select using (public.is_store_member(store_id));

create policy pricing_rules_insert on public.pricing_rules
  for insert with check (public.is_store_member(store_id));

create policy pricing_rules_update on public.pricing_rules
  for update
  using (public.is_store_member(store_id))
  with check (public.is_store_member(store_id));

create policy pricing_rules_delete on public.pricing_rules
  for delete using (public.is_store_member(store_id));

-- Replaces a store's entire rule set atomically. saveRules used to do this
-- as two separate delete/insert network calls -- if the insert failed after
-- the delete had already succeeded, a store's whole pricing config was
-- silently wiped with nothing to replace it. A single function call is
-- atomic by construction. Deliberately NOT security definer: it runs as the
-- calling role, so the is_store_member RLS policies above still gate the
-- internal delete/insert exactly as they did before -- this changes
-- atomicity, not the security model.
create function public.replace_pricing_rules(p_store_id uuid, p_rules jsonb)
returns void
language plpgsql
as $$
begin
  delete from public.pricing_rules where store_id = p_store_id;

  insert into public.pricing_rules (store_id, step_order, rule_type, config, enabled)
  select
    p_store_id,
    (rule->>'stepOrder')::integer,
    rule->>'ruleType',
    coalesce(rule->'config', '{}'::jsonb),
    coalesce((rule->>'enabled')::boolean, true)
  from jsonb_array_elements(p_rules) as rule;
end;
$$;

grant execute on function public.replace_pricing_rules(uuid, jsonb) to authenticated;
