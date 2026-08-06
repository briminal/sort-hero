-- _apply_buylist_payout previously computed the store-credit amount from
-- the submission-level total_offer_credit_cents, which is the total as if
-- EVERY item were paid out as credit. That ignores buylist_items.payout_type
-- (the per-item cash/credit choice the portal cart already collects and
-- submitBuylist already stores), so a customer's mixed cash/credit
-- selection had zero effect on what was actually credited -- payout was
-- always all-cash or all-credit for the whole submission. This makes the
-- credit amount a per-item sum driven by each item's own payout_type
-- instead. create_pos_buy is updated to stamp payout_type on every
-- inserted item from its single p_payout_method (POS has no per-item
-- choice), so POS purchases still behave exactly as before.

create or replace function public._apply_buylist_payout(p_submission_id uuid, p_payout_method text)
returns void
language plpgsql
as $$
declare
  v_store_id uuid;
  v_customer_id uuid;
  v_credit_owed integer := 0;
  v_item record;
  v_existing_inventory_id uuid;
begin
  select store_id, customer_id
  into v_store_id, v_customer_id
  from public.buylist_submissions
  where id = p_submission_id;

  if v_store_id is null then
    raise exception 'Submission not found';
  end if;

  for v_item in
    select id, card_id, condition, quantity_approved, offered_credit_price_cents, payout_type
    from public.buylist_items
    where submission_id = p_submission_id and coalesce(quantity_approved, 0) > 0 and sent_to_inventory_at is null
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

    -- Each item's own payout_type governs its payout, not the whole
    -- submission's p_payout_method -- honors a customer's per-item
    -- cash/credit mix from the portal cart. Cash-type items need no DB
    -- action (paid out physically); p_payout_method is still recorded on
    -- the submission below for display/record-keeping.
    if coalesce(v_item.payout_type, 'cash') = 'credit' then
      v_credit_owed := v_credit_owed + coalesce(v_item.offered_credit_price_cents, 0) * v_item.quantity_approved;
    end if;

    update public.buylist_items set sent_to_inventory_at = now() where id = v_item.id;
  end loop;

  if v_credit_owed > 0 then
    update public.buylist_customers
    set store_credit_balance_cents = store_credit_balance_cents + v_credit_owed
    where id = v_customer_id;

    insert into public.store_credit_transactions (store_id, customer_id, amount_cents, reason, submission_id)
    values (v_store_id, v_customer_id, v_credit_owed, 'Buylist payout', p_submission_id);
  end if;

  update public.buylist_submissions
  set status = 'completed', payout_method = p_payout_method
  where id = p_submission_id;
end;
$$;

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
  v_payout_type text;
begin
  v_email := nullif(p_customer->>'email', '');
  v_payout_type := case when p_payout_method = 'store_credit' then 'credit' else 'cash' end;

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
      quantity_submitted, quantity_approved, offered_unit_price_cents, offered_credit_price_cents,
      payout_type
    )
    values (
      v_submission_id,
      (v_item->>'cardId')::uuid,
      v_item->>'cardName',
      v_item->>'condition',
      (v_item->>'quantity')::integer,
      (v_item->>'quantity')::integer,
      (v_item->>'cashPriceCents')::integer,
      (v_item->>'creditPriceCents')::integer,
      v_payout_type
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
