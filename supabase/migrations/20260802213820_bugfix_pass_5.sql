-- Bug-hunt pass #5 (post-Orders & Shipping module review): fixes a real
-- TOCTOU race where two concurrent purchaseLabel calls for the same order
-- (two browser tabs, a retried request after a timeout) could both pass
-- the "not already fulfilled" pre-check and both go on to purchase a real
-- Shippo label -- the store gets charged twice, and since
-- shipments.marketplace_order_id is unique, the second call's
-- create_shipment insert would fail *after* the money was already spent,
-- discarding the proof of that wasted purchase.
--
-- Fix: split create_shipment into claim -> (external Shippo call) ->
-- finalize. The claim step's INSERT is the actual atomic reservation (the
-- unique constraint on shipments.marketplace_order_id guarantees only one
-- concurrent claim can succeed), and it happens BEFORE any money is spent,
-- not after.

drop function if exists public.create_shipment(uuid, text, text, text, text, text, text, text, integer);

create function public.claim_shipment_for_label(p_marketplace_order_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_store_id uuid;
  v_status text;
  v_shipment_id uuid;
begin
  select store_id, status into v_store_id, v_status
  from public.marketplace_orders where id = p_marketplace_order_id;

  if v_store_id is null then
    raise exception 'Marketplace order not found';
  end if;
  if v_status = 'fulfilled' then
    raise exception 'This order already has a label';
  end if;

  insert into public.shipments (store_id, marketplace_order_id, status)
  values (v_store_id, p_marketplace_order_id, 'label_created')
  returning id into v_shipment_id;

  return v_shipment_id;
exception
  when unique_violation then
    raise exception 'A label purchase is already in progress or complete for this order';
end;
$$;

grant execute on function public.claim_shipment_for_label(uuid) to authenticated;

-- Called once the real Shippo purchase succeeds -- fills in the claimed
-- placeholder row and flips the order to fulfilled, atomically together.
create function public.finalize_shipment(
  p_shipment_id uuid,
  p_shippo_shipment_id text,
  p_shippo_transaction_id text,
  p_tracking_number text,
  p_tracking_url text,
  p_label_url text,
  p_carrier_name text,
  p_service_level text,
  p_rate_cents integer
)
returns void
language plpgsql
as $$
declare
  v_marketplace_order_id uuid;
begin
  update public.shipments
  set shippo_shipment_id = p_shippo_shipment_id,
      shippo_transaction_id = p_shippo_transaction_id,
      tracking_number = p_tracking_number,
      tracking_url = p_tracking_url,
      label_url = p_label_url,
      carrier_name = p_carrier_name,
      service_level = p_service_level,
      rate_cents = p_rate_cents
  where id = p_shipment_id
  returning marketplace_order_id into v_marketplace_order_id;

  if v_marketplace_order_id is null then
    raise exception 'Shipment claim not found';
  end if;

  update public.marketplace_orders set status = 'fulfilled' where id = v_marketplace_order_id;
end;
$$;

grant execute on function public.finalize_shipment(uuid, text, text, text, text, text, text, text, integer) to authenticated;

-- Rollback path: if the Shippo purchase itself fails after a successful
-- claim, release the reservation so the order isn't stuck unshippable
-- forever. Guarded to only ever delete an un-finalized placeholder.
create function public.release_shipment_claim(p_shipment_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.shipments
  where id = p_shipment_id and status = 'label_created' and tracking_number is null;
end;
$$;

grant execute on function public.release_shipment_claim(uuid) to authenticated;

-- shipments never had a delete grant/policy (the original module had no
-- delete path at all) -- release_shipment_claim above is NOT security
-- definer, so it runs as the calling role and needs one, the exact same
-- "missing grant" bug class as everywhere else in this project, this time
-- introduced by this very migration's own new RPC.
grant delete on public.shipments to authenticated;
create policy shipments_delete on public.shipments
  for delete using (public.is_store_member(store_id));

-- marketplace_connections is subscribed to by settings/marketplaces/sync-status.tsx
-- but was never added to the publication -- the connection-status half of
-- that UI (status/last_error/last_synced_at) silently never received live
-- updates.
alter publication supabase_realtime add table public.marketplace_connections;
