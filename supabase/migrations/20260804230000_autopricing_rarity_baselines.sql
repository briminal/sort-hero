-- Autopricing Phase 2: Rarity Baseline Prices tab.
--
-- A per-(config, rarity) floor price -- genuinely new concept, nothing like
-- it in buylist. `rarity` is free text (not a fixed enum) since it mirrors
-- cards.rarity, which is itself free text sourced verbatim from each game's
-- external catalog (MMTG/Pokemon/etc. all use different rarity vocabularies)
-- -- a hardcoded 8-value MTG-shaped list would be wrong for every other
-- game. foil_baseline_cents is nullable/independent of normal_baseline_cents
-- so "Advanced Mode" (splitting normal vs. foil) is just "is this column
-- populated," no separate mode flag needed on the config itself.

create table public.autopricing_rarity_baselines (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.autopricing_configs(id) on delete cascade,
  rarity text not null,
  normal_baseline_cents integer check (normal_baseline_cents is null or normal_baseline_cents >= 0),
  foil_baseline_cents integer check (foil_baseline_cents is null or foil_baseline_cents >= 0),
  unique (config_id, rarity)
);

create index autopricing_rarity_baselines_config_id_idx on public.autopricing_rarity_baselines(config_id);

grant select, insert, update, delete on public.autopricing_rarity_baselines to authenticated;
grant select, insert, update, delete on public.autopricing_rarity_baselines to service_role;

alter table public.autopricing_rarity_baselines enable row level security;

-- No direct store_id -- scoped via the parent config's store, same pattern
-- as buylist_items/order_items etc.
create policy autopricing_rarity_baselines_select on public.autopricing_rarity_baselines
  for select using (
    exists (select 1 from public.autopricing_configs c where c.id = autopricing_rarity_baselines.config_id and public.is_store_member(c.store_id))
  );
create policy autopricing_rarity_baselines_insert on public.autopricing_rarity_baselines
  for insert with check (
    exists (select 1 from public.autopricing_configs c where c.id = autopricing_rarity_baselines.config_id and public.is_store_member(c.store_id))
  );
create policy autopricing_rarity_baselines_update on public.autopricing_rarity_baselines
  for update
  using (exists (select 1 from public.autopricing_configs c where c.id = autopricing_rarity_baselines.config_id and public.is_store_member(c.store_id)))
  with check (exists (select 1 from public.autopricing_configs c where c.id = autopricing_rarity_baselines.config_id and public.is_store_member(c.store_id)));
create policy autopricing_rarity_baselines_delete on public.autopricing_rarity_baselines
  for delete using (
    exists (select 1 from public.autopricing_configs c where c.id = autopricing_rarity_baselines.config_id and public.is_store_member(c.store_id))
  );

-- Whole-list replace per config, same atomic delete+insert shape as every
-- other "replace_*" RPC in this project.
create function public.replace_autopricing_rarity_baselines(p_config_id uuid, p_baselines jsonb)
returns void
language plpgsql
as $$
begin
  delete from public.autopricing_rarity_baselines where config_id = p_config_id;

  insert into public.autopricing_rarity_baselines (config_id, rarity, normal_baseline_cents, foil_baseline_cents)
  select
    p_config_id,
    b->>'rarity',
    nullif(b->>'normalBaselineCents', '')::integer,
    nullif(b->>'foilBaselineCents', '')::integer
  from jsonb_array_elements(p_baselines) as b;
end;
$$;

grant execute on function public.replace_autopricing_rarity_baselines(uuid, jsonb) to authenticated;
