-- Bug-hunt pass #6 (full-project sweep): closes several POS money-integrity
-- holes found by re-reviewing every payment/refund RPC against the same bar
-- CLAUDE.md sets (server always recomputes/reverifies, nothing trusts a
-- client-submitted amount, sensitive mutations are atomic under a lock).

-- (1) complete_order only checked order status + inventory stock, never
-- that the order was actually paid. The TS wrapper (maybeCompleteOrder)
-- checked payment sufficiency before calling it, but the RPC itself is
-- granted execute to `authenticated` and is a normal PostgREST-callable
-- function -- any store member can call supabase.rpc('complete_order', ...)
-- directly from the browser, bypassing the TS check entirely, completing a
-- sale (and decrementing real inventory) with zero payments recorded. Given
-- CLAUDE.md's own POS threat model (employee theft/fraud), this needed the
-- check inside the RPC, not just in the calling code.
create or replace function public.complete_order(p_order_id uuid)
returns void
language plpgsql
as $$
declare
  v_status text;
  v_total integer;
  v_paid integer;
  v_item record;
  v_available integer;
begin
  select status, total_cents into v_status, v_total from public.orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'Order not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Order is not pending (status: %)', v_status;
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid
  from public.payments
  where order_id = p_order_id and status = 'succeeded';

  if v_paid < v_total then
    raise exception 'Order is not fully paid (paid %, total %)', v_paid, v_total;
  end if;

  for v_item in
    select oi.inventory_item_id, oi.quantity, oi.card_name
    from public.order_items oi
    where oi.order_id = p_order_id and oi.inventory_item_id is not null
    order by oi.inventory_item_id
  loop
    select quantity into v_available from public.inventory_items where id = v_item.inventory_item_id for update;

    if v_available is null or v_available < v_item.quantity then
      raise exception 'Not enough stock for % (have %, need %)', v_item.card_name, coalesce(v_available, 0), v_item.quantity;
    end if;

    update public.inventory_items set quantity = quantity - v_item.quantity where id = v_item.inventory_item_id;
  end loop;

  update public.orders set status = 'completed' where id = p_order_id;
end;
$$;

-- (2) Cash/card payment recording did the "how much is left to pay" check
-- (getOrderRemainingCents) and the payments insert as two separate,
-- unlocked round trips. Two concurrent payment attempts for the same order
-- (a double-tap before the button disables, a retried request after a
-- network blip) could both read the same remaining balance and both
-- succeed, over-paying/double-charging the order. This locks the order row
-- for the whole check+insert, same pattern as redeem_store_credit's
-- customer-balance lock.
create function public.record_pos_payment(
  p_order_id uuid,
  p_method text,
  p_amount_cents integer,
  p_stripe_payment_intent_id text default null
)
returns uuid
language plpgsql
as $$
declare
  v_status text;
  v_total integer;
  v_paid integer;
  v_payment_id uuid;
begin
  select status, total_cents into v_status, v_total from public.orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'Order not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'Order is not pending (status: %)', v_status;
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid
  from public.payments
  where order_id = p_order_id and status = 'succeeded';

  if p_amount_cents > (v_total - v_paid) then
    raise exception 'Amount exceeds the order''s remaining balance (remaining %, requested %)', v_total - v_paid, p_amount_cents;
  end if;

  insert into public.payments (order_id, method, amount_cents, stripe_payment_intent_id, status)
  values (p_order_id, p_method, p_amount_cents, p_stripe_payment_intent_id, 'succeeded')
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

grant execute on function public.record_pos_payment(uuid, text, integer, text) to authenticated;

-- Belt-and-suspenders alongside record_pos_payment's locked check: a
-- retried confirmCardPayment call (client never saw the first response) for
-- the same Stripe PaymentIntent can no longer insert a second payments row.
create unique index payments_stripe_payment_intent_id_idx
  on public.payments(stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- redeem_store_credit only checked the customer's own balance, never the
-- order's remaining balance -- a repeat/duplicate call (or a split payment
-- where the client miscalculates the remaining split) could debit a
-- customer's store credit for more than the order still owes. Now locks and
-- rechecks the order the same way record_pos_payment does.
create or replace function public.redeem_store_credit(p_order_id uuid, p_customer_id uuid, p_amount_cents integer)
returns uuid
language plpgsql
as $$
declare
  v_store_id uuid;
  v_balance integer;
  v_payment_id uuid;
  v_status text;
  v_total integer;
  v_paid integer;
begin
  select status, total_cents into v_status, v_total from public.orders where id = p_order_id for update;
  if v_status is null then
    raise exception 'Order not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'Order is not pending (status: %)', v_status;
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid
  from public.payments where order_id = p_order_id and status = 'succeeded';

  if p_amount_cents > (v_total - v_paid) then
    raise exception 'Amount exceeds the order''s remaining balance (remaining %, requested %)', v_total - v_paid, p_amount_cents;
  end if;

  select store_credit_balance_cents into v_balance
  from public.buylist_customers where id = p_customer_id for update;

  if v_balance is null then
    raise exception 'Customer not found';
  end if;

  if v_balance < p_amount_cents then
    raise exception 'Insufficient store credit balance (has %, needs %)', v_balance, p_amount_cents;
  end if;

  select store_id into v_store_id from public.buylist_customers where id = p_customer_id;

  update public.buylist_customers
  set store_credit_balance_cents = store_credit_balance_cents - p_amount_cents
  where id = p_customer_id;

  insert into public.store_credit_transactions (store_id, customer_id, amount_cents, reason, order_id)
  values (v_store_id, p_customer_id, -p_amount_cents, 'POS redemption', p_order_id);

  insert into public.payments (order_id, method, amount_cents, status)
  values (p_order_id, 'store_credit', p_amount_cents, 'succeeded')
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

-- (3) processReturn called stripe.refunds.create with a TS-computed amount
-- *before* apply_return's atomic already-refunded clamp ever ran -- Stripe
-- only rejects a refund that exceeds the *original charge total*, not a
-- second valid partial refund, so two return requests for the same
-- item(s) (double-click, retried request) could each independently pass
-- and each issue a real Stripe refund, over-refunding the order. Splits
-- apply_return into reserve -> (Stripe call happens in TS against the
-- reserved, already-clamped amount) -> finalize, mirroring the
-- claim-before-spend pattern this project already uses for Shippo label
-- purchases.
drop function if exists public.apply_return(uuid, jsonb, integer, text, text);

create function public.reserve_return(p_order_id uuid, p_requested_amount_cents integer, p_reason text default null)
returns table (refund_id uuid, actual_amount_cents integer)
language plpgsql
as $$
declare
  v_total_cents integer;
  v_refunded_so_far integer;
  v_remaining_refundable integer;
  v_actual_refund_cents integer;
  v_refund_id uuid;
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

  v_actual_refund_cents := least(p_requested_amount_cents, v_remaining_refundable);

  insert into public.refunds (order_id, amount_cents, reason, stripe_refund_id)
  values (p_order_id, v_actual_refund_cents, p_reason, null)
  returning id into v_refund_id;

  return query select v_refund_id, v_actual_refund_cents;
end;
$$;

grant execute on function public.reserve_return(uuid, integer, text) to authenticated;

-- cancel_return_reservation deletes a refunds row, and finalize_return
-- updates one (to attach the Stripe refund id) -- refunds previously only
-- had select/insert granted to authenticated (there was no delete/update
-- path before this split), so without these grants every cancellation or
-- finalization would fail with a permission error.
grant update, delete on public.refunds to authenticated;
grant update, delete on public.refunds to service_role;

-- Frees a reservation that never got finalized (e.g. the Stripe call itself
-- failed after reserve_return but before finalize_return) -- only allowed
-- while nothing has been restocked against it yet.
create function public.cancel_return_reservation(p_refund_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.refunds
  where id = p_refund_id
    and not exists (select 1 from public.refund_items where refund_id = p_refund_id);
end;
$$;

grant execute on function public.cancel_return_reservation(uuid) to authenticated;

create function public.finalize_return(
  p_refund_id uuid,
  p_items jsonb,
  p_stripe_refund_id text default null
)
returns void
language plpgsql
as $$
declare
  v_order_id uuid;
  v_total_cents integer;
  v_refunded_so_far integer;
  v_item jsonb;
  v_inventory_item_id uuid;
  v_requested_qty integer;
  v_sold_qty integer;
  v_already_returned integer;
  v_allowed_qty integer;
begin
  select order_id into v_order_id from public.refunds where id = p_refund_id for update;
  if v_order_id is null then
    raise exception 'Refund not found';
  end if;

  update public.refunds set stripe_refund_id = p_stripe_refund_id where id = p_refund_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_inventory_item_id := (v_item->>'inventoryItemId')::uuid;
    v_requested_qty := (v_item->>'quantity')::integer;

    select coalesce(sum(quantity), 0) into v_sold_qty
    from public.order_items
    where order_id = v_order_id and inventory_item_id = v_inventory_item_id;

    select coalesce(sum(ri.quantity), 0) into v_already_returned
    from public.refund_items ri
    join public.refunds r on r.id = ri.refund_id
    where r.order_id = v_order_id and ri.inventory_item_id = v_inventory_item_id and r.id <> p_refund_id;

    v_allowed_qty := least(v_requested_qty, greatest(0, v_sold_qty - v_already_returned));
    if v_allowed_qty <= 0 then
      continue;
    end if;

    update public.inventory_items
    set quantity = quantity + v_allowed_qty
    where id = v_inventory_item_id;

    insert into public.refund_items (refund_id, inventory_item_id, quantity)
    values (p_refund_id, v_inventory_item_id, v_allowed_qty);
  end loop;

  select total_cents into v_total_cents from public.orders where id = v_order_id;
  select coalesce(sum(amount_cents), 0) into v_refunded_so_far
  from public.refunds where order_id = v_order_id;

  update public.orders
  set status = case when v_refunded_so_far >= v_total_cents then 'refunded' else 'partially_refunded' end
  where id = v_order_id;
end;
$$;

grant execute on function public.finalize_return(uuid, jsonb, text) to authenticated;
