-- Reports (Module #13): COGS tracking + a unified sales line-item view.
--
-- Cost basis (cost_cents) only exists where it can be derived from a real
-- purchase: buylist payouts. Manually-scanned inventory with no buylist
-- origin has no known cost -- left null rather than guessed at, and every
-- margin computation in this project must treat null cost as "unknown",
-- never as zero (zero would silently overstate margin).

alter table public.inventory_items add column cost_cents integer;
alter table public.order_items add column unit_cost_cents integer;
alter table public.marketplace_order_items add column unit_cost_cents integer;

-- Weighted-average cost: multiple buylist purchases can land in the same
-- (store_id, card_id, condition) bucket at different prices over time, and
-- this project deliberately doesn't do per-lot/FIFO costing (out of scope,
-- see the module plan) -- a blended average is the pragmatic middle ground.
create or replace function public._apply_buylist_payout(p_submission_id uuid, p_payout_method text)
returns void
language plpgsql
as $$
declare
  v_store_id uuid;
  v_customer_id uuid;
  v_total integer;
  v_item record;
  v_existing_inventory_id uuid;
begin
  select store_id, customer_id, total_offer_cents
  into v_store_id, v_customer_id, v_total
  from public.buylist_submissions
  where id = p_submission_id;

  if v_store_id is null then
    raise exception 'Submission not found';
  end if;

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
      -- set expressions all evaluate against the pre-update row, so
      -- referencing quantity/cost_cents here (and their new values) in the
      -- same statement is safe.
      update public.inventory_items
      set quantity = quantity + v_item.quantity_approved,
          cost_cents = case
            when cost_cents is null then v_item.offered_unit_price_cents
            else (cost_cents * quantity + v_item.offered_unit_price_cents * v_item.quantity_approved)
                 / (quantity + v_item.quantity_approved)
          end
      where id = v_existing_inventory_id;
    else
      insert into public.inventory_items (store_id, card_id, condition, quantity, status, cost_cents)
      values (v_store_id, v_item.card_id, v_item.condition, v_item.quantity_approved, 'confirmed', v_item.offered_unit_price_cents);
    end if;
  end loop;

  if p_payout_method = 'store_credit' then
    update public.buylist_customers
    set store_credit_balance_cents = store_credit_balance_cents + coalesce(v_total, 0)
    where id = v_customer_id;

    insert into public.store_credit_transactions (store_id, customer_id, amount_cents, reason, submission_id)
    values (v_store_id, v_customer_id, coalesce(v_total, 0), 'Buylist payout', p_submission_id);
  end if;

  update public.buylist_submissions
  set status = 'completed', payout_method = p_payout_method
  where id = p_submission_id;
end;
$$;

-- Snapshot unit_cost_cents at sale time, same "snapshot at transaction
-- time" convention already used for card_name -- so margin stays accurate
-- historically even if inventory_items.cost_cents changes later.
create or replace function public.import_marketplace_order(
  p_store_id uuid,
  p_connection_id uuid,
  p_platform text,
  p_external_order_id text,
  p_subtotal_cents integer,
  p_total_cents integer,
  p_customer_name text,
  p_customer_email text,
  p_shipping_address jsonb,
  p_raw_payload jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_available integer;
  v_inventory_item_id uuid;
  v_oversold boolean := false;
begin
  insert into public.marketplace_orders (
    store_id, connection_id, platform, external_order_id,
    subtotal_cents, total_cents, customer_name, customer_email,
    shipping_address, raw_payload
  )
  values (
    p_store_id, p_connection_id, p_platform, p_external_order_id,
    p_subtotal_cents, p_total_cents, p_customer_name, p_customer_email,
    p_shipping_address, p_raw_payload
  )
  on conflict (connection_id, external_order_id) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select id into v_order_id from public.marketplace_orders
    where connection_id = p_connection_id and external_order_id = p_external_order_id;
    return v_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) order by (value->>'inventoryItemId')
  loop
    v_inventory_item_id := nullif(v_item->>'inventoryItemId', '')::uuid;

    insert into public.marketplace_order_items (
      marketplace_order_id, inventory_item_id, card_id, card_name,
      quantity, unit_price_cents, line_total_cents, unit_cost_cents
    )
    values (
      v_order_id, v_inventory_item_id, (v_item->>'cardId')::uuid, v_item->>'cardName',
      (v_item->>'quantity')::integer, (v_item->>'unitPriceCents')::integer, (v_item->>'lineTotalCents')::integer,
      (select cost_cents from public.inventory_items where id = v_inventory_item_id)
    );

    if v_inventory_item_id is not null then
      select quantity into v_available from public.inventory_items where id = v_inventory_item_id for update;

      if v_available is not null then
        update public.inventory_items
        set quantity = greatest(0, quantity - (v_item->>'quantity')::integer)
        where id = v_inventory_item_id;

        if v_available < (v_item->>'quantity')::integer then
          v_oversold := true;
        end if;
      else
        v_oversold := true;
      end if;
    end if;
  end loop;

  if v_oversold then
    update public.marketplace_orders
    set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('oversold_warning', true)
    where id = v_order_id;
  end if;

  return v_order_id;
end;
$$;

-- Unified line-item-level sales view -- same security_invoker pattern as
-- order_queue, so RLS on the base tables (already correctly scoped via
-- each item's parent order's store_id) applies to the querying user
-- automatically; no extra filtering needed here.
create view public.sales_line_items with (security_invoker = true) as
  select
    oi.id,
    o.store_id,
    'pos'::text as source_type,
    null::text as platform,
    oi.card_id,
    oi.card_name,
    oi.quantity,
    oi.unit_price_cents,
    oi.line_total_cents,
    oi.unit_cost_cents,
    o.created_at,
    o.status as order_status
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  union all
  select
    moi.id,
    mo.store_id,
    'marketplace'::text as source_type,
    mo.platform,
    moi.card_id,
    moi.card_name,
    moi.quantity,
    moi.unit_price_cents,
    moi.line_total_cents,
    moi.unit_cost_cents,
    mo.created_at,
    mo.status as order_status
  from public.marketplace_order_items moi
  join public.marketplace_orders mo on mo.id = moi.marketplace_order_id;

grant select on public.sales_line_items to authenticated;
grant select on public.sales_line_items to service_role;
