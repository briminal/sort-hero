-- Bug-hunt pass #4: store-credit payments were silently unrefundable.
-- processReturn only ever looked for a payments row with method='card' to
-- decide whether to issue a refund; a store_credit payment matched nothing,
-- so returning an item paid for with store credit restocked inventory and
-- recorded a `refunds` row, but never gave the customer's balance back --
-- the money just vanished with no audit trail pointing at the gap. There
-- was also no way to even trace which customer a store_credit payment
-- belonged to, since `payments` had no link to `buylist_customers`.

-- Links a store_credit payment back to the customer whose balance it
-- debited, so a later return can find who to credit back.
alter table public.payments add column customer_id uuid references public.buylist_customers(id);

-- redeem_store_credit now stamps customer_id onto the payments row it
-- creates (previously omitted it entirely -- the column didn't exist yet).
create or replace function public.redeem_store_credit(p_order_id uuid, p_customer_id uuid, p_amount_cents integer)
returns uuid
language plpgsql
as $$
declare
  v_store_id uuid;
  v_balance integer;
  v_payment_id uuid;
begin
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

  insert into public.payments (order_id, method, amount_cents, status, customer_id)
  values (p_order_id, 'store_credit', p_amount_cents, 'succeeded', p_customer_id)
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

-- The other half of the fix: a return that traces back to a store_credit
-- payment re-credits the customer's balance and logs it, mirroring
-- redeem_store_credit's bookkeeping in reverse. Not security definer, same
-- reasoning as every other atomic RPC in this project -- RLS still applies.
create function public.refund_store_credit(
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
begin
  select store_id into v_store_id from public.buylist_customers where id = p_customer_id;

  if v_store_id is null then
    raise exception 'Customer not found';
  end if;

  update public.buylist_customers
  set store_credit_balance_cents = store_credit_balance_cents + p_amount_cents
  where id = p_customer_id;

  insert into public.store_credit_transactions (store_id, customer_id, amount_cents, reason, order_id)
  values (v_store_id, p_customer_id, p_amount_cents, p_reason, p_order_id);
end;
$$;

grant execute on function public.refund_store_credit(uuid, integer, uuid, text) to authenticated;
