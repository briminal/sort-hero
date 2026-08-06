-- Buylist Phase 4: per-item verify + send-to-inventory split.
--
-- Previously, an accepted submission's inventory arrival and payout only
-- happened as one atomic all-items-at-once step in _apply_buylist_payout at
-- completion. This lets staff verify (confirm the physically-received
-- quantity/condition matches what was priced) and send each item to
-- inventory independently, one card at a time, as they work through a big
-- submission -- without waiting for every line to be checked before any of
-- it lands in inventory. Completion still runs at the end for whatever
-- wasn't already sent individually, plus the payout.

alter table public.buylist_items add column verified_quantity integer;
alter table public.buylist_items add column sent_to_inventory_at timestamptz;

alter table public.buylist_items add constraint buylist_items_verified_quantity_check
  check (verified_quantity is null or verified_quantity >= 0);

-- Staff confirms the physically-received quantity for one line. Can't
-- verify more than what was approved/priced -- verification narrows, it
-- doesn't grant a bigger payout than was already agreed.
create function public.verify_buylist_item(p_item_id uuid, p_verified_quantity integer)
returns void
language plpgsql
as $$
declare
  v_status text;
  v_quantity_approved integer;
begin
  select s.status, i.quantity_approved
  into v_status, v_quantity_approved
  from public.buylist_items i
  join public.buylist_submissions s on s.id = i.submission_id
  where i.id = p_item_id
  for update of i;

  if v_status is null then
    raise exception 'Item not found';
  end if;
  if v_status <> 'accepted' then
    raise exception 'Items can only be verified once the submission is accepted (status: %)', v_status;
  end if;
  if p_verified_quantity > coalesce(v_quantity_approved, 0) then
    raise exception 'Verified quantity (%) cannot exceed the approved quantity (%)', p_verified_quantity, v_quantity_approved;
  end if;

  update public.buylist_items set verified_quantity = p_verified_quantity where id = p_item_id;
end;
$$;

grant execute on function public.verify_buylist_item(uuid, integer) to authenticated;

-- Moves one already-verified line into inventory immediately, independent
-- of the rest of the submission. Idempotent guard against double-sending
-- the same line (which would double the inventory quantity).
create function public.send_buylist_item_to_inventory(p_item_id uuid)
returns void
language plpgsql
as $$
declare
  v_store_id uuid;
  v_status text;
  v_card_id uuid;
  v_condition text;
  v_verified_quantity integer;
  v_sent_at timestamptz;
  v_existing_inventory_id uuid;
begin
  select s.store_id, s.status, i.card_id, i.condition, i.verified_quantity, i.sent_to_inventory_at
  into v_store_id, v_status, v_card_id, v_condition, v_verified_quantity, v_sent_at
  from public.buylist_items i
  join public.buylist_submissions s on s.id = i.submission_id
  where i.id = p_item_id
  for update of i;

  if v_store_id is null then
    raise exception 'Item not found';
  end if;
  if v_status <> 'accepted' then
    raise exception 'Items can only be sent to inventory once the submission is accepted (status: %)', v_status;
  end if;
  if v_sent_at is not null then
    raise exception 'Item has already been sent to inventory';
  end if;
  if v_verified_quantity is null then
    raise exception 'Item must be verified before it can be sent to inventory';
  end if;
  if v_verified_quantity <= 0 then
    raise exception 'Verified quantity must be greater than zero to send to inventory';
  end if;

  select id into v_existing_inventory_id
  from public.inventory_items
  where store_id = v_store_id and card_id = v_card_id and condition = v_condition
  limit 1;

  if v_existing_inventory_id is not null then
    update public.inventory_items
    set quantity = quantity + v_verified_quantity
    where id = v_existing_inventory_id;
  else
    insert into public.inventory_items (store_id, card_id, condition, quantity, status)
    values (v_store_id, v_card_id, v_condition, v_verified_quantity, 'confirmed');
  end if;

  update public.buylist_items set sent_to_inventory_at = now() where id = p_item_id;
end;
$$;

grant execute on function public.send_buylist_item_to_inventory(uuid) to authenticated;

-- Completion now only sweeps items that weren't already sent individually
-- (avoids double-counting inventory for lines staff already processed),
-- and marks whatever it does process as sent for a consistent audit trail.
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
    select id, card_id, condition, quantity_approved, offered_unit_price_cents
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

    update public.buylist_items set sent_to_inventory_at = now() where id = v_item.id;
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
