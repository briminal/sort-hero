-- Bug-hunt (final sweep): apply_return/refund_store_credit had no
-- protection against being invoked twice for the same order -- a
-- double-click, a retry after a network blip, or two staff processing the
-- same return could re-credit a customer's store-credit balance and
-- re-restock inventory a second time. The card-refund path was only
-- accidentally safe because Stripe itself rejects over-refunding a charge;
-- store credit had no equivalent backstop.

-- Per-refund line items -- lets apply_return cap each item's returned
-- quantity against what's actually still returnable (original sold qty
-- minus already-returned qty), the same way order_items is the source of
-- truth for what was sold.
create table public.refund_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.refunds(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity integer not null
);

create index refund_items_refund_id_idx on public.refund_items(refund_id);

grant select, insert on public.refund_items to authenticated;
grant select, insert on public.refund_items to service_role;

alter table public.refund_items enable row level security;

create policy refund_items_select on public.refund_items
  for select using (
    exists (
      select 1 from public.refunds r
      join public.orders o on o.id = r.order_id
      where r.id = refund_items.refund_id and public.is_store_member(o.store_id)
    )
  );

create policy refund_items_insert on public.refund_items
  for insert with check (
    exists (
      select 1 from public.refunds r
      join public.orders o on o.id = r.order_id
      where r.id = refund_items.refund_id and public.is_store_member(o.store_id)
    )
  );

-- Now atomic and idempotent: locks the order first, clamps the refund
-- amount to what's actually still refundable, and clamps each item's
-- restocked quantity to what's actually still returnable -- a repeat call
-- with the same (or overlapping) items has no further effect once the
-- order/items are already fully returned, instead of compounding.
-- Return shape changed (uuid -> table), so the old signature must be
-- dropped first -- create or replace can't change a function's return type.
drop function if exists public.apply_return(uuid, jsonb, integer, text, text);

create function public.apply_return(
  p_order_id uuid,
  p_items jsonb,
  p_refund_amount_cents integer,
  p_reason text,
  p_stripe_refund_id text default null
)
returns table (refund_id uuid, actual_refund_amount_cents integer)
language plpgsql
as $$
declare
  v_refund_id uuid;
  v_item jsonb;
  v_total_cents integer;
  v_refunded_so_far integer;
  v_remaining_refundable integer;
  v_actual_refund_cents integer;
  v_inventory_item_id uuid;
  v_requested_qty integer;
  v_sold_qty integer;
  v_already_returned integer;
  v_allowed_qty integer;
begin
  select total_cents into v_total_cents from public.orders where id = p_order_id for update;
  if v_total_cents is null then
    raise exception 'Order not found';
  end if;

  select coalesce(sum(amount_cents), 0) into v_refunded_so_far
  from public.refunds where order_id = p_order_id;

  v_remaining_refundable := v_total_cents - v_refunded_so_far;
  if v_remaining_refundable <= 0 then
    raise exception 'Order is already fully refunded';
  end if;

  v_actual_refund_cents := least(p_refund_amount_cents, v_remaining_refundable);

  insert into public.refunds (order_id, amount_cents, reason, stripe_refund_id)
  values (p_order_id, v_actual_refund_cents, p_reason, p_stripe_refund_id)
  returning id into v_refund_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_inventory_item_id := (v_item->>'inventoryItemId')::uuid;
    v_requested_qty := (v_item->>'quantity')::integer;

    select coalesce(sum(quantity), 0) into v_sold_qty
    from public.order_items
    where order_id = p_order_id and inventory_item_id = v_inventory_item_id;

    select coalesce(sum(ri.quantity), 0) into v_already_returned
    from public.refund_items ri
    join public.refunds r on r.id = ri.refund_id
    where r.order_id = p_order_id and ri.inventory_item_id = v_inventory_item_id;

    v_allowed_qty := least(v_requested_qty, greatest(0, v_sold_qty - v_already_returned));
    if v_allowed_qty <= 0 then
      continue;
    end if;

    update public.inventory_items
    set quantity = quantity + v_allowed_qty
    where id = v_inventory_item_id;

    insert into public.refund_items (refund_id, inventory_item_id, quantity)
    values (v_refund_id, v_inventory_item_id, v_allowed_qty);
  end loop;

  select coalesce(sum(amount_cents), 0) into v_refunded_so_far
  from public.refunds where order_id = p_order_id;

  update public.orders
  set status = case when v_refunded_so_far >= v_total_cents then 'refunded' else 'partially_refunded' end
  where id = p_order_id;

  return query select v_refund_id, v_actual_refund_cents;
end;
$$;

grant execute on function public.apply_return(uuid, jsonb, integer, text, text) to authenticated;

-- Clamps against the original store-credit payment amount for this order
-- minus what's already been credited back for it -- a repeat call has no
-- further effect once that's exhausted.
create or replace function public.refund_store_credit(
  p_customer_id uuid,
  p_amount_cents integer,
  p_order_id uuid,
  p_reason text default 'POS return'
)
returns void
language plpgsql
as $$
declare
  v_store_id uuid;
  v_original_paid_cents integer;
  v_already_refunded_cents integer;
  v_remaining_cents integer;
begin
  select store_id into v_store_id from public.buylist_customers where id = p_customer_id for update;

  if v_store_id is null then
    raise exception 'Customer not found';
  end if;

  select coalesce(sum(amount_cents), 0) into v_original_paid_cents
  from public.payments
  where order_id = p_order_id and method = 'store_credit' and status = 'succeeded';

  select coalesce(sum(amount_cents), 0) into v_already_refunded_cents
  from public.store_credit_transactions
  where order_id = p_order_id and amount_cents > 0;

  v_remaining_cents := least(p_amount_cents, v_original_paid_cents - v_already_refunded_cents);
  if v_remaining_cents <= 0 then
    return;
  end if;

  update public.buylist_customers
  set store_credit_balance_cents = store_credit_balance_cents + v_remaining_cents
  where id = p_customer_id;

  insert into public.store_credit_transactions (store_id, customer_id, amount_cents, reason, order_id)
  values (v_store_id, p_customer_id, v_remaining_cents, p_reason, p_order_id);
end;
$$;

grant execute on function public.refund_store_credit(uuid, integer, uuid, text) to authenticated;
