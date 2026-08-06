-- Buylist Phase 2: tiered cash/credit pricing.
--
-- Adds per-game rule scoping, a new 'tiered_price' rule type (buy-side only
-- -- see src/types/buylist-pricing.ts, deliberately NOT merged into the
-- shared autopricing rule_type/config so this never surfaces in the sell-side
-- pricing UI), independent cash vs. store-credit offer amounts, and a
-- fallback price-source chain (market/low/high/mid, each with its own
-- percent modifier) so a missing market price doesn't silently price at $0.

-- Null game_id = applies to every game; a specific game_id fully replaces
-- the global rule set for that game (see rulesForGame in buylist-offer.ts).
alter table public.buylist_pricing_rules add column game_id uuid references public.games(id);
create index buylist_pricing_rules_game_id_idx on public.buylist_pricing_rules(game_id);

alter table public.buylist_pricing_rules drop constraint buylist_pricing_rules_rule_type_check;
alter table public.buylist_pricing_rules add constraint buylist_pricing_rules_rule_type_check
  check (rule_type in (
    'condition_multiplier', 'margin_percent', 'margin_fixed',
    'round_to_nearest', 'min_price', 'max_price', 'tiered_price'
  ));

-- offered_unit_price_cents keeps its existing meaning (the cash offer) so no
-- pre-existing row or reader breaks; offered_credit_price_cents is additive.
alter table public.buylist_items add column offered_credit_price_cents integer;

-- Additive per-channel totals alongside the existing total_offer_cents
-- (which keeps meaning "cash total" for every reader that hasn't been
-- updated to show both channels).
alter table public.buylist_submissions add column total_offer_credit_cents integer;

create table public.buylist_price_source_config (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  game_id uuid references public.games(id),
  primary_source text not null default 'market' check (primary_source in ('market', 'low', 'high', 'mid')),
  secondary_source text check (secondary_source in ('market', 'low', 'high', 'mid')),
  last_call_source text check (last_call_source in ('market', 'low', 'high', 'mid')),
  doomsday_source text check (doomsday_source in ('market', 'low', 'high', 'mid')),
  primary_modifier_pct numeric not null default 0,
  secondary_modifier_pct numeric not null default 0,
  last_call_modifier_pct numeric not null default 0,
  doomsday_modifier_pct numeric not null default 0,
  created_at timestamptz not null default now()
);

-- One config row per store+game (game_id null = the store's default chain);
-- coalesce to a sentinel so the uniqueness works with a nullable column.
create unique index buylist_price_source_config_store_game_idx
  on public.buylist_price_source_config(store_id, coalesce(game_id, '00000000-0000-0000-0000-000000000000'::uuid));

grant select, insert, update, delete on public.buylist_price_source_config to authenticated;
grant select, insert, update, delete on public.buylist_price_source_config to service_role;

alter table public.buylist_price_source_config enable row level security;

create policy buylist_price_source_config_select on public.buylist_price_source_config
  for select using (public.is_store_member(store_id));
create policy buylist_price_source_config_insert on public.buylist_price_source_config
  for insert with check (public.is_store_member(store_id));
create policy buylist_price_source_config_update on public.buylist_price_source_config
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));
create policy buylist_price_source_config_delete on public.buylist_price_source_config
  for delete using (public.is_store_member(store_id));

-- Same delete+insert atomic replace shape as replace_buylist_pricing_rules,
-- now also carrying game_id.
create or replace function public.replace_buylist_pricing_rules(p_store_id uuid, p_rules jsonb)
returns void
language plpgsql
as $$
begin
  delete from public.buylist_pricing_rules where store_id = p_store_id;

  insert into public.buylist_pricing_rules (store_id, game_id, step_order, rule_type, config, enabled)
  select
    p_store_id,
    nullif(rule->>'gameId', '')::uuid,
    (rule->>'stepOrder')::integer,
    rule->>'ruleType',
    coalesce(rule->'config', '{}'::jsonb),
    coalesce((rule->>'enabled')::boolean, true)
  from jsonb_array_elements(p_rules) as rule;
end;
$$;

-- One row per (store, game) -- delete then insert, same pattern as the
-- pricing rules replace function.
create function public.replace_buylist_price_source_config(p_store_id uuid, p_game_id uuid, p_config jsonb)
returns void
language plpgsql
as $$
begin
  delete from public.buylist_price_source_config
  where store_id = p_store_id and game_id is not distinct from p_game_id;

  insert into public.buylist_price_source_config (
    store_id, game_id, primary_source, secondary_source, last_call_source, doomsday_source,
    primary_modifier_pct, secondary_modifier_pct, last_call_modifier_pct, doomsday_modifier_pct
  )
  values (
    p_store_id,
    p_game_id,
    coalesce(p_config->>'primarySource', 'market'),
    nullif(p_config->>'secondarySource', ''),
    nullif(p_config->>'lastCallSource', ''),
    nullif(p_config->>'doomsdaySource', ''),
    coalesce((p_config->>'primaryModifierPercent')::numeric, 0),
    coalesce((p_config->>'secondaryModifierPercent')::numeric, 0),
    coalesce((p_config->>'lastCallModifierPercent')::numeric, 0),
    coalesce((p_config->>'doomsdayModifierPercent')::numeric, 0)
  );
end;
$$;

grant execute on function public.replace_buylist_price_source_config(uuid, uuid, jsonb) to authenticated;

-- Staff now sets both channel prices per line; totals are tracked per
-- channel too so the customer can be shown both before choosing a payout
-- method.
create or replace function public.price_buylist_submission(p_submission_id uuid, p_items jsonb)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_cash_total integer;
  v_credit_total integer;
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    update public.buylist_items
    set
      quantity_approved = (v_item->>'quantityApproved')::integer,
      offered_unit_price_cents = (v_item->>'offeredCashPriceCents')::integer,
      offered_credit_price_cents = (v_item->>'offeredCreditPriceCents')::integer
    where id = (v_item->>'itemId')::uuid and submission_id = p_submission_id;
  end loop;

  select
    coalesce(sum(quantity_approved * offered_unit_price_cents), 0),
    coalesce(sum(quantity_approved * coalesce(offered_credit_price_cents, offered_unit_price_cents)), 0)
  into v_cash_total, v_credit_total
  from public.buylist_items
  where submission_id = p_submission_id;

  update public.buylist_submissions
  set status = 'priced', total_offer_cents = v_cash_total, total_offer_credit_cents = v_credit_total
  where id = p_submission_id;
end;
$$;

-- Payout now picks whichever channel total matches the chosen method,
-- instead of the single total that used to be the only option.
create or replace function public._apply_buylist_payout(p_submission_id uuid, p_payout_method text)
returns void
language plpgsql
as $$
declare
  v_store_id uuid;
  v_customer_id uuid;
  v_cash_total integer;
  v_credit_total integer;
  v_payout_total integer;
  v_item record;
  v_existing_inventory_id uuid;
begin
  select store_id, customer_id, total_offer_cents, total_offer_credit_cents
  into v_store_id, v_customer_id, v_cash_total, v_credit_total
  from public.buylist_submissions
  where id = p_submission_id;

  if v_store_id is null then
    raise exception 'Submission not found';
  end if;

  v_payout_total := case when p_payout_method = 'store_credit' then coalesce(v_credit_total, v_cash_total) else v_cash_total end;

  for v_item in
    select card_id, condition, quantity_approved, offered_unit_price_cents
    from public.buylist_items
    where submission_id = p_submission_id and coalesce(quantity_approved, 0) > 0
  loop
    select id into v_existing_inventory_id
    from public.inventory_items
    where store_id = v_store_id and card_id = v_item.card_id and condition = v_item.condition
    limit 1;

    if v_existing_inventory_id is not null then
      update public.inventory_items
      set quantity = quantity + v_item.quantity_approved
      where id = v_existing_inventory_id;
    else
      insert into public.inventory_items (store_id, card_id, condition, quantity, status)
      values (v_store_id, v_item.card_id, v_item.condition, v_item.quantity_approved, 'confirmed');
    end if;
  end loop;

  if p_payout_method = 'store_credit' then
    update public.buylist_customers
    set store_credit_balance_cents = store_credit_balance_cents + coalesce(v_payout_total, 0)
    where id = v_customer_id;

    insert into public.store_credit_transactions (store_id, customer_id, amount_cents, reason, submission_id)
    values (v_store_id, v_customer_id, coalesce(v_payout_total, 0), 'Buylist payout', p_submission_id);
  end if;

  -- total_offer_cents/total_offer_credit_cents are left untouched here --
  -- they mean "the cash offer" / "the credit offer" everywhere they're
  -- displayed (queue board, submission detail, portal status), and
  -- overwriting either with "the amount actually paid" would make a
  -- store-credit payout retroactively corrupt the cash figure. Which one
  -- was actually paid is what payout_method already records.
  update public.buylist_submissions
  set status = 'completed', payout_method = p_payout_method
  where id = p_submission_id;
end;
$$;

-- POS "buy mode": items now arrive with both channel prices already
-- computed (offer was recomputed server-side just before this call, same as
-- before); the method is already known upfront so both totals are stored
-- for consistency with the portal flow.
create or replace function public.create_pos_buy(
  p_store_id uuid,
  p_customer jsonb,
  p_items jsonb,
  p_payout_method text
)
returns uuid
language plpgsql
as $$
declare
  v_customer_id uuid;
  v_submission_id uuid;
  v_item jsonb;
  v_cash_total integer := 0;
  v_credit_total integer := 0;
  v_email text;
begin
  v_email := nullif(p_customer->>'email', '');

  if v_email is not null then
    select id into v_customer_id from public.buylist_customers
    where store_id = p_store_id and email = v_email;
  end if;

  if v_customer_id is null then
    insert into public.buylist_customers (store_id, name, email, phone)
    values (p_store_id, nullif(p_customer->>'name', ''), v_email, nullif(p_customer->>'phone', ''))
    returning id into v_customer_id;
  end if;

  insert into public.buylist_submissions (store_id, customer_id, channel, status)
  values (p_store_id, v_customer_id, 'pos', 'accepted')
  returning id into v_submission_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.buylist_items (
      submission_id, card_id, card_name, condition,
      quantity_submitted, quantity_approved, offered_unit_price_cents, offered_credit_price_cents
    )
    values (
      v_submission_id,
      (v_item->>'cardId')::uuid,
      v_item->>'cardName',
      v_item->>'condition',
      (v_item->>'quantity')::integer,
      (v_item->>'quantity')::integer,
      (v_item->>'cashPriceCents')::integer,
      (v_item->>'creditPriceCents')::integer
    );
    v_cash_total := v_cash_total + (v_item->>'quantity')::integer * (v_item->>'cashPriceCents')::integer;
    v_credit_total := v_credit_total + (v_item->>'quantity')::integer * (v_item->>'creditPriceCents')::integer;
  end loop;

  update public.buylist_submissions
  set total_offer_cents = v_cash_total, total_offer_credit_cents = v_credit_total
  where id = v_submission_id;

  perform public._apply_buylist_payout(v_submission_id, p_payout_method);

  return v_submission_id;
end;
$$;
