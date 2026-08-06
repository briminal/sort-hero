-- Bugfix pass 7: CSV import atomicity + closing raw-table write gaps found
-- in the latest full-project sweep.

-- commitImportRows previously ran one Supabase update/insert call per row
-- in a plain loop -- on row N's failure, rows 1..N-1 were already committed
-- individually (no shared transaction), leaving a partial import. Wrapping
-- the whole commit in a single plpgsql function makes it atomic: an
-- unhandled exception on any row aborts the entire call and Postgres rolls
-- back everything done during it. SECURITY INVOKER (the default) so this
-- still runs under the caller's role and inventory_items RLS applies.
create or replace function public.commit_inventory_import(p_store_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_row jsonb;
  v_id uuid;
  v_count integer;
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_id := nullif(v_row->>'id', '')::uuid;

    if v_id is not null then
      update public.inventory_items
      set card_id = (v_row->>'cardId')::uuid,
          quantity = coalesce((v_row->>'quantity')::integer, 1),
          condition = coalesce(v_row->>'condition', 'NM'),
          price_cents = nullif(v_row->>'priceCents', '')::integer,
          notes = nullif(v_row->>'notes', '')
      where id = v_id and store_id = p_store_id;
      get diagnostics v_count = row_count;
      if v_count > 0 then
        v_updated := v_updated + 1;
        continue;
      end if;
    end if;

    insert into public.inventory_items (store_id, card_id, quantity, condition, price_cents, notes, status)
    values (
      p_store_id,
      (v_row->>'cardId')::uuid,
      coalesce((v_row->>'quantity')::integer, 1),
      coalesce(v_row->>'condition', 'NM'),
      nullif(v_row->>'priceCents', '')::integer,
      nullif(v_row->>'notes', ''),
      'confirmed'
    );
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

grant execute on function public.commit_inventory_import(uuid, jsonb) to authenticated;

-- applyAutopricing's batch reprice previously issued one sequential
-- Supabase update() per inventory item (reads were already batched, writes
-- were not) -- for a store with thousands of priced SKUs that's thousands
-- of round-trips inside one Server Action invocation, risking a Vercel
-- function timeout partway through with no indication of which items were
-- and weren't repriced. A single set-based UPDATE does it in one round trip.
create or replace function public.bulk_reprice_inventory(p_store_id uuid, p_updates jsonb)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  update public.inventory_items ii
  set price_cents = u.price_cents
  from jsonb_to_recordset(p_updates) as u(id uuid, price_cents integer)
  where ii.id = u.id and ii.store_id = p_store_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.bulk_reprice_inventory(uuid, jsonb) to authenticated;

-- saveBuylistPricingRules previously worked around
-- replace_buylist_pricing_rules only supporting a full-store replace by
-- reading every rule, filtering out the scope being edited, and resending
-- everything else untouched alongside the new scope's rules. Two staff
-- editing different scopes concurrently would race: whichever save lands
-- second re-inserts the OTHER scope's rules as they were at ITS OWN page
-- load, silently reverting the first staffer's already-saved change. This
-- RPC instead deletes/inserts only the one (game_id, set_id) scope being
-- saved, so editing one scope can never touch another's rows at all --
-- eliminating the race by construction rather than by client-side care.
create or replace function public.replace_buylist_pricing_rules_for_scope(
  p_store_id uuid,
  p_game_id uuid,
  p_set_id uuid,
  p_rules jsonb
)
returns void
language plpgsql
as $$
begin
  delete from public.buylist_pricing_rules
  where store_id = p_store_id
    and game_id is not distinct from p_game_id
    and set_id is not distinct from p_set_id;

  insert into public.buylist_pricing_rules (store_id, game_id, set_id, step_order, rule_type, config, enabled)
  select
    p_store_id,
    p_game_id,
    p_set_id,
    (rule->>'stepOrder')::integer,
    rule->>'ruleType',
    coalesce(rule->'config', '{}'::jsonb),
    coalesce((rule->>'enabled')::boolean, true)
  from jsonb_array_elements(p_rules) as rule;
end;
$$;

grant execute on function public.replace_buylist_pricing_rules_for_scope(uuid, uuid, uuid, jsonb) to authenticated;

-- price_buylist_submission previously had no submission-status guard (unlike
-- approve_buylist_submission/verify_buylist_item, which both check status)
-- and no bound on quantityApproved vs. what the customer actually
-- submitted. That let a direct call re-price an already declined/completed
-- submission (flipping it back to 'priced' so the customer could "accept"
-- a resolved offer again) or approve more quantity than was ever sent,
-- inflating the eventual inventory-add/store-credit payout.
create or replace function public.price_buylist_submission(p_submission_id uuid, p_items jsonb)
returns void
language plpgsql
as $$
declare
  v_status text;
  v_item jsonb;
  v_item_id uuid;
  v_quantity_approved integer;
  v_quantity_submitted integer;
  v_cash_total integer;
  v_credit_total integer;
begin
  select status into v_status from public.buylist_submissions where id = p_submission_id for update;
  if v_status is null then
    raise exception 'Submission not found';
  end if;
  if v_status not in ('pending', 'priced') then
    raise exception 'Submission can only be priced while pending or already priced (status: %)', v_status;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item->>'itemId')::uuid;
    v_quantity_approved := (v_item->>'quantityApproved')::integer;

    select quantity_submitted into v_quantity_submitted
    from public.buylist_items
    where id = v_item_id and submission_id = p_submission_id;
    if v_quantity_submitted is null then
      raise exception 'Item % not found on this submission', v_item_id;
    end if;
    if v_quantity_approved > v_quantity_submitted then
      raise exception 'Approved quantity (%) cannot exceed what was submitted (%)', v_quantity_approved, v_quantity_submitted;
    end if;

    update public.buylist_items
    set
      quantity_approved = v_quantity_approved,
      offered_unit_price_cents = (v_item->>'offeredCashPriceCents')::integer,
      offered_credit_price_cents = (v_item->>'offeredCreditPriceCents')::integer
    where id = v_item_id and submission_id = p_submission_id;
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

-- reserve_return previously only checked that the order existed and wasn't
-- already fully refunded, with no check on order status at all. A `pending`
-- order (cart built via createOrder, inventory NOT yet decremented -- that
-- only happens in complete_order on full payment) already has a
-- total_cents, so reserve_return/finalize_return could be called directly
-- against an unpaid order: finalize_return would then add inventory back
-- for a "sale" that never happened and never decremented stock in the first
-- place, flipping the order to refunded/partially_refunded despite no
-- successful payment ever existing. Only orders that have actually taken a
-- payment (completed, or already partially refunded) can have a return
-- reserved against them.
create or replace function public.reserve_return(p_order_id uuid, p_requested_amount_cents integer, p_reason text default null)
returns table (refund_id uuid, actual_amount_cents integer)
language plpgsql
as $$
declare
  v_total_cents integer;
  v_status text;
  v_refunded_so_far integer;
  v_remaining_refundable integer;
  v_actual_refund_cents integer;
  v_refund_id uuid;
begin
  select total_cents, status into v_total_cents, v_status from public.orders where id = p_order_id for update;
  if v_total_cents is null then
    raise exception 'Order not found';
  end if;
  if v_status not in ('completed', 'partially_refunded') then
    raise exception 'Order has not been paid -- cannot return items against it (status: %)', v_status;
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
