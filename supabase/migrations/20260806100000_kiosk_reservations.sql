-- Kiosk parity pass, phase 2: reservation + staff handoff. Checkout on the
-- kiosk never collects payment (deliberately -- see CLAUDE.md's kiosk
-- lower-trust-scope stance) -- it only records what the customer wants and
-- how to reach them, so staff can pull it up on the POS and take payment
-- normally.
create table public.kiosk_reservations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  customer_name_or_phone text not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  total_cents integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index kiosk_reservations_store_id_idx on public.kiosk_reservations(store_id);

create trigger kiosk_reservations_set_updated_at
before update on public.kiosk_reservations
for each row execute function public.set_updated_at();

-- Snapshots card_name/unit_price_cents at reservation time (same reasoning
-- as order_items) so the staff view stays accurate even if the card is
-- later renamed or repriced, and inventory_item_id is kept to look up
-- current live stock when loading into the POS.
create table public.kiosk_reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.kiosk_reservations(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id),
  card_name text not null,
  condition text not null,
  printing text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null
);

create index kiosk_reservation_items_reservation_id_idx on public.kiosk_reservation_items(reservation_id);

alter table public.kiosk_reservations enable row level security;
alter table public.kiosk_reservation_items enable row level security;

-- Staff can see/manage their own store's reservations (mirrors every other
-- store-scoped table). No anon/authenticated insert policy -- reservations
-- are only ever created via submit_kiosk_reservation (service-role, called
-- from the kiosk's server action after re-validating stock/price), the same
-- pattern buylist portal submissions use.
create policy kiosk_reservations_select on public.kiosk_reservations
  for select using (public.is_store_member(store_id));
create policy kiosk_reservations_update on public.kiosk_reservations
  for update using (public.is_store_member(store_id));

create policy kiosk_reservation_items_select on public.kiosk_reservation_items
  for select using (public.is_store_member((select store_id from public.kiosk_reservations where id = reservation_id)));

grant select, update on public.kiosk_reservations to authenticated;
grant select, insert, update on public.kiosk_reservations to service_role;
grant select on public.kiosk_reservation_items to authenticated;
grant select, insert on public.kiosk_reservation_items to service_role;

-- Re-validates every line against live stock/price server-side (never
-- trusts the kiosk cart's client-held prices/quantities -- same rule as
-- every other checkout path in this app) and creates the reservation
-- atomically. SECURITY DEFINER: the kiosk is an anonymous session with no
-- store-member JWT, so it can't satisfy is_store_member() itself -- the
-- calling action re-derives store_id from the (already-validated) kiosk
-- session before invoking this, same trust boundary as the buylist portal.
create function public.submit_kiosk_reservation(p_store_id uuid, p_customer_name_or_phone text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_inventory_item_id uuid;
  v_requested_qty integer;
  v_available_qty integer;
  v_price_cents integer;
  v_card_id uuid;
  v_card_name text;
  v_condition text;
  v_printing text;
  v_allowed_qty integer;
  v_total_cents integer := 0;
  v_reservation_id uuid;
  v_line_count integer := 0;
begin
  insert into public.kiosk_reservations (store_id, customer_name_or_phone, total_cents)
  values (p_store_id, p_customer_name_or_phone, 0)
  returning id into v_reservation_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_inventory_item_id := (v_item->>'inventoryItemId')::uuid;
    v_requested_qty := (v_item->>'quantity')::integer;

    select i.quantity, i.price_cents, i.card_id, c.name, i.condition, i.printing
    into v_available_qty, v_price_cents, v_card_id, v_card_name, v_condition, v_printing
    from public.inventory_items i
    join public.cards c on c.id = i.card_id
    where i.id = v_inventory_item_id and i.store_id = p_store_id and i.status = 'confirmed'
    for update of i;

    if v_available_qty is null then
      continue;
    end if;

    v_allowed_qty := least(v_requested_qty, v_available_qty);
    if v_allowed_qty <= 0 or v_price_cents is null then
      continue;
    end if;

    insert into public.kiosk_reservation_items (reservation_id, inventory_item_id, card_name, condition, printing, quantity, unit_price_cents)
    values (v_reservation_id, v_inventory_item_id, v_card_name, v_condition, v_printing, v_allowed_qty, v_price_cents);

    v_total_cents := v_total_cents + v_allowed_qty * v_price_cents;
    v_line_count := v_line_count + 1;
  end loop;

  if v_line_count = 0 then
    raise exception 'No items in this cart are still available';
  end if;

  update public.kiosk_reservations set total_cents = v_total_cents where id = v_reservation_id;

  return v_reservation_id;
end;
$$;

grant execute on function public.submit_kiosk_reservation(uuid, text, jsonb) to service_role;

-- Staff-side "mark handled" once payment is taken at the register.
create function public.complete_kiosk_reservation(p_reservation_id uuid)
returns void
language plpgsql
as $$
declare
  v_store_id uuid;
begin
  select store_id into v_store_id from public.kiosk_reservations where id = p_reservation_id;
  if v_store_id is null or not public.is_store_member(v_store_id) then
    raise exception 'Reservation not found';
  end if;

  update public.kiosk_reservations set status = 'completed' where id = p_reservation_id;
end;
$$;

grant execute on function public.complete_kiosk_reservation(uuid) to authenticated;
