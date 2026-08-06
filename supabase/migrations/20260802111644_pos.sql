-- POS: tills, orders, order_items, payments, refunds. All store-scoped via
-- the existing is_store_member/is_store_owner helpers. No delete policies
-- on the financial tables (orders/order_items/payments/refunds) -- these
-- are a record corrected via refunds, not deletion.

create table public.tills (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  name text not null,
  status text not null default 'closed' check (status in ('open', 'closed')),
  opened_by uuid references auth.users(id),
  opened_at timestamptz,
  closed_at timestamptz,
  opening_cash_cents integer,
  closing_cash_cents integer,
  created_at timestamptz not null default now()
);

create index tills_store_id_idx on public.tills(store_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  till_id uuid not null references public.tills(id),
  status text not null default 'pending' check (status in (
    'pending', 'completed', 'refunded', 'partially_refunded', 'cancelled'
  )),
  subtotal_cents integer not null,
  total_cents integer not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_store_id_idx on public.orders(store_id);
create index orders_till_id_idx on public.orders(till_id);

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- Snapshots card_id/card_name so sale history survives inventory edits or
-- deletions -- inventory_item_id is kept too, for the return flow to know
-- which live inventory row to credit back.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  inventory_item_id uuid references public.inventory_items(id),
  card_id uuid not null references public.cards(id),
  card_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null,
  line_total_cents integer not null
);

create index order_items_order_id_idx on public.order_items(order_id);

-- One order can have multiple payment rows (split payments).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  method text not null check (method in ('card', 'cash')),
  amount_cents integer not null,
  stripe_payment_intent_id text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  created_at timestamptz not null default now()
);

create index payments_order_id_idx on public.payments(order_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  amount_cents integer not null,
  reason text,
  stripe_refund_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index refunds_order_id_idx on public.refunds(order_id);

grant select, insert, update on public.tills to authenticated;
grant select, insert, update on public.tills to service_role;
grant select, insert, update on public.orders to authenticated;
grant select, insert, update on public.orders to service_role;
grant select, insert on public.order_items to authenticated;
grant select, insert on public.order_items to service_role;
grant select, insert, update on public.payments to authenticated;
grant select, insert, update on public.payments to service_role;
grant select, insert on public.refunds to authenticated;
grant select, insert on public.refunds to service_role;

alter table public.tills enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;

create policy tills_select on public.tills for select using (public.is_store_member(store_id));
create policy tills_insert on public.tills for insert with check (public.is_store_member(store_id));
create policy tills_update on public.tills
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

create policy orders_select on public.orders for select using (public.is_store_member(store_id));
create policy orders_insert on public.orders for insert with check (public.is_store_member(store_id));
create policy orders_update on public.orders
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

-- order_items/payments/refunds have no direct store_id column -- scoped via
-- their parent order's store instead.
create policy order_items_select on public.order_items
  for select using (
    exists (select 1 from public.orders o where o.id = order_items.order_id and public.is_store_member(o.store_id))
  );
create policy order_items_insert on public.order_items
  for insert with check (
    exists (select 1 from public.orders o where o.id = order_items.order_id and public.is_store_member(o.store_id))
  );

create policy payments_select on public.payments
  for select using (
    exists (select 1 from public.orders o where o.id = payments.order_id and public.is_store_member(o.store_id))
  );
create policy payments_insert on public.payments
  for insert with check (
    exists (select 1 from public.orders o where o.id = payments.order_id and public.is_store_member(o.store_id))
  );
create policy payments_update on public.payments
  for update
  using (exists (select 1 from public.orders o where o.id = payments.order_id and public.is_store_member(o.store_id)))
  with check (exists (select 1 from public.orders o where o.id = payments.order_id and public.is_store_member(o.store_id)));

create policy refunds_select on public.refunds
  for select using (
    exists (select 1 from public.orders o where o.id = refunds.order_id and public.is_store_member(o.store_id))
  );
create policy refunds_insert on public.refunds
  for insert with check (
    exists (select 1 from public.orders o where o.id = refunds.order_id and public.is_store_member(o.store_id))
  );

-- Atomic completion: decrements inventory and marks the order completed in
-- one transaction. Not security definer -- runs as the calling role, so the
-- RLS policies above still gate every internal statement exactly as they
-- would for separate calls; this changes atomicity, not the security model
-- (same reasoning as replace_pricing_rules in the autopricing migration).
create function public.complete_order(p_order_id uuid)
returns void
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'Order not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Order is not pending (status: %)', v_status;
  end if;

  update public.inventory_items ii
  set quantity = ii.quantity - oi.quantity
  from public.order_items oi
  where oi.order_id = p_order_id and oi.inventory_item_id = ii.id;

  update public.orders set status = 'completed' where id = p_order_id;
end;
$$;

grant execute on function public.complete_order(uuid) to authenticated;

-- Atomic return: credits inventory back, records the refund, and updates
-- order status, all in one transaction.
create function public.apply_return(
  p_order_id uuid,
  p_items jsonb,
  p_refund_amount_cents integer,
  p_reason text,
  p_stripe_refund_id text default null
)
returns uuid
language plpgsql
as $$
declare
  v_refund_id uuid;
  v_item jsonb;
  v_total_cents integer;
  v_refunded_so_far integer;
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    update public.inventory_items
    set quantity = quantity + (v_item->>'quantity')::integer
    where id = (v_item->>'inventoryItemId')::uuid;
  end loop;

  insert into public.refunds (order_id, amount_cents, reason, stripe_refund_id)
  values (p_order_id, p_refund_amount_cents, p_reason, p_stripe_refund_id)
  returning id into v_refund_id;

  select total_cents into v_total_cents from public.orders where id = p_order_id;
  select coalesce(sum(amount_cents), 0) into v_refunded_so_far from public.refunds where order_id = p_order_id;

  update public.orders
  set status = case when v_refunded_so_far >= v_total_cents then 'refunded' else 'partially_refunded' end
  where id = p_order_id;

  return v_refund_id;
end;
$$;

grant execute on function public.apply_return(uuid, jsonb, integer, text, text) to authenticated;

-- Realtime only pushes postgres_changes for tables explicitly added to this
-- publication -- CLAUDE.md requires live till sync (no polling), so tills
-- must be in it. Not orders/payments/refunds: no current UI subscribes to
-- those, and every table added here is broadcast to any authenticated
-- client whose RLS-filtered subscription matches, so keep it minimal.
alter publication supabase_realtime add table public.tills;
