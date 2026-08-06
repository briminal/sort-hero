-- Buylist Phase 3: set-specific condition overrides.
--
-- Extends the per-game rule scoping from Phase 2 with an optional set_id, so
-- a shop can configure a different condition-multiplier/pricing pipeline for
-- a specific set (e.g. a high-value set where even LP copies hold most of
-- their value) without touching the rest of the game's rules. Resolution
-- order (most to least specific): rules scoped to the card's exact set,
-- else rules scoped to the card's game, else the store's global rules --
-- same "most specific fully replaces" contract Phase 2 established for
-- game scoping, just one level deeper.

alter table public.buylist_pricing_rules add column set_id uuid references public.sets(id);
create index buylist_pricing_rules_set_id_idx on public.buylist_pricing_rules(set_id);

-- A set-scoped rule only makes sense paired with its game -- enforced here
-- rather than trusted from the client, since resolution matches on the pair.
alter table public.buylist_pricing_rules add constraint buylist_pricing_rules_set_requires_game
  check (set_id is null or game_id is not null);

create or replace function public.replace_buylist_pricing_rules(p_store_id uuid, p_rules jsonb)
returns void
language plpgsql
as $$
begin
  delete from public.buylist_pricing_rules where store_id = p_store_id;

  insert into public.buylist_pricing_rules (store_id, game_id, set_id, step_order, rule_type, config, enabled)
  select
    p_store_id,
    nullif(rule->>'gameId', '')::uuid,
    nullif(rule->>'setId', '')::uuid,
    (rule->>'stepOrder')::integer,
    rule->>'ruleType',
    coalesce(rule->'config', '{}'::jsonb),
    coalesce((rule->>'enabled')::boolean, true)
  from jsonb_array_elements(p_rules) as rule;
end;
$$;
