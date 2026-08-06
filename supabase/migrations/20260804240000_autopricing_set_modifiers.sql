-- Autopricing Phase 3 (final tab): Set Modifiers.
--
-- Per-set condition-modifier overrides -- the same underlying idea as
-- buylist's set-specific condition overrides, but shaped as fixed
-- NM/LP/MP/HP/DMG columns (matching this tab's own simple form) rather than
-- buylist's generic replaceable rule pipeline, since autopricing's
-- condition modifiers were never a generic rule type to begin with (see the
-- Condition Modifiers tab). Each column is independently nullable so a set
-- can override just one condition and fall back to the config's global
-- Condition Modifiers for the rest -- this is what the reference product's
-- "Show Partial" filter is filtering on.

create table public.autopricing_set_modifiers (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.autopricing_configs(id) on delete cascade,
  set_id uuid not null references public.sets(id),
  nm_modifier_pct numeric,
  lp_modifier_pct numeric,
  mp_modifier_pct numeric,
  hp_modifier_pct numeric,
  dmg_modifier_pct numeric,
  unique (config_id, set_id)
);

create index autopricing_set_modifiers_config_id_idx on public.autopricing_set_modifiers(config_id);

grant select, insert, update, delete on public.autopricing_set_modifiers to authenticated;
grant select, insert, update, delete on public.autopricing_set_modifiers to service_role;

alter table public.autopricing_set_modifiers enable row level security;

create policy autopricing_set_modifiers_select on public.autopricing_set_modifiers
  for select using (
    exists (select 1 from public.autopricing_configs c where c.id = autopricing_set_modifiers.config_id and public.is_store_member(c.store_id))
  );
create policy autopricing_set_modifiers_insert on public.autopricing_set_modifiers
  for insert with check (
    exists (select 1 from public.autopricing_configs c where c.id = autopricing_set_modifiers.config_id and public.is_store_member(c.store_id))
  );
create policy autopricing_set_modifiers_update on public.autopricing_set_modifiers
  for update
  using (exists (select 1 from public.autopricing_configs c where c.id = autopricing_set_modifiers.config_id and public.is_store_member(c.store_id)))
  with check (exists (select 1 from public.autopricing_configs c where c.id = autopricing_set_modifiers.config_id and public.is_store_member(c.store_id)));
create policy autopricing_set_modifiers_delete on public.autopricing_set_modifiers
  for delete using (
    exists (select 1 from public.autopricing_configs c where c.id = autopricing_set_modifiers.config_id and public.is_store_member(c.store_id))
  );

-- One set at a time (added/edited individually via search, unlike rarity
-- baselines' whole-list replace) -- insert-or-update on the (config_id,
-- set_id) uniqueness.
create function public.upsert_autopricing_set_modifier(
  p_config_id uuid,
  p_set_id uuid,
  p_nm_modifier_pct numeric,
  p_lp_modifier_pct numeric,
  p_mp_modifier_pct numeric,
  p_hp_modifier_pct numeric,
  p_dmg_modifier_pct numeric
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.autopricing_set_modifiers (config_id, set_id, nm_modifier_pct, lp_modifier_pct, mp_modifier_pct, hp_modifier_pct, dmg_modifier_pct)
  values (p_config_id, p_set_id, p_nm_modifier_pct, p_lp_modifier_pct, p_mp_modifier_pct, p_hp_modifier_pct, p_dmg_modifier_pct)
  on conflict (config_id, set_id) do update set
    nm_modifier_pct = excluded.nm_modifier_pct,
    lp_modifier_pct = excluded.lp_modifier_pct,
    mp_modifier_pct = excluded.mp_modifier_pct,
    hp_modifier_pct = excluded.hp_modifier_pct,
    dmg_modifier_pct = excluded.dmg_modifier_pct
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.upsert_autopricing_set_modifier(uuid, uuid, numeric, numeric, numeric, numeric, numeric) to authenticated;
