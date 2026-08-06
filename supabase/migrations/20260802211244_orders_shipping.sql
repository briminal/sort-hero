-- gen_random_bytes (used below for the Shippo webhook token) is from
-- pgcrypto, unlike gen_random_uuid() which is built into Postgres 13+.
create extension if not exists pgcrypto;

-- Orders & Shipping: unifies POS orders and marketplace orders into one
-- read queue, adds Shippo label generation for marketplace orders (POS
-- orders are picked up in store, no shipping), and pushes tracking numbers
-- back out to the originating marketplace once a label is bought.

-- Unified read queue. security_invoker = true is load-bearing: without it,
-- this view would run with the *view creator's* privileges instead of the
-- querying user's, silently bypassing every RLS policy already proven on
-- orders/marketplace_orders -- the same class of mistake the grant/RLS
-- lessons elsewhere in this project exist to prevent, just for views
-- instead of tables. This is the first view in the project.
create view public.order_queue with (security_invoker = true) as
  select
    id, store_id, 'pos'::text as source_type, null::text as platform,
    status, subtotal_cents, total_cents, created_at,
    null::text as customer_name, null::text as customer_email, null::jsonb as shipping_address
  from public.orders
  union all
  select
    id, store_id, 'marketplace'::text as source_type, platform,
    status, subtotal_cents, total_cents, created_at,
    customer_name, customer_email, shipping_address
  from public.marketplace_orders;

grant select on public.order_queue to authenticated;
grant select on public.order_queue to service_role;

-- Same credentials-split pattern as marketplace_connections/marketplace_credentials:
-- non-secret status readable by staff, the API key itself service_role-only
-- with no grant to authenticated at all.
create table public.shipping_connections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  provider text not null check (provider in ('shippo')),
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  from_address jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider)
);

create index shipping_connections_store_id_idx on public.shipping_connections(store_id);

create trigger shipping_connections_set_updated_at
before update on public.shipping_connections
for each row execute function public.set_updated_at();

create table public.shipping_credentials (
  connection_id uuid primary key references public.shipping_connections(id) on delete cascade,
  shippo_api_key text,
  -- Shippo has no documented public webhook-registration API like
  -- Shopify's (webhooks are configured manually in Shippo's dashboard),
  -- and doesn't sign webhook payloads by default -- this is a random
  -- token embedded in the webhook URL the merchant pastes into Shippo's
  -- dashboard (/api/webhooks/shippo?token=...), the standard workaround
  -- for that gap.
  webhook_token text not null default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One per marketplace order -- POS orders never ship, so no polymorphic FK.
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  marketplace_order_id uuid not null references public.marketplace_orders(id) unique,
  carrier text not null default 'shippo',
  status text not null default 'label_created' check (status in ('label_created', 'in_transit', 'delivered', 'cancelled')),
  shippo_shipment_id text,
  shippo_transaction_id text,
  tracking_number text,
  tracking_url text,
  label_url text,
  carrier_name text,
  service_level text,
  rate_cents integer,
  tracking_push_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shipments_store_id_idx on public.shipments(store_id);
create index shipments_marketplace_order_id_idx on public.shipments(marketplace_order_id);

create trigger shipments_set_updated_at
before update on public.shipments
for each row execute function public.set_updated_at();

-- Grants (RLS restricts rows, not table access -- both needed, same lesson
-- applied in every prior migration this project).
grant select, insert, update on public.shipping_connections to authenticated;
grant select, insert, update on public.shipping_connections to service_role;
-- Deliberately no grant to authenticated on shipping_credentials.
grant select, insert, update on public.shipping_credentials to service_role;
grant select, insert, update on public.shipments to authenticated;
grant select, insert, update on public.shipments to service_role;

alter table public.shipping_connections enable row level security;
alter table public.shipping_credentials enable row level security;
alter table public.shipments enable row level security;

create policy shipping_connections_select on public.shipping_connections
  for select using (public.is_store_member(store_id));
-- Connecting a carrier means writing credentials -- owner-only, same
-- sensitivity tier as marketplace connections.
create policy shipping_connections_insert on public.shipping_connections
  for insert with check (public.is_store_owner(store_id));
create policy shipping_connections_update on public.shipping_connections
  for update using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));

-- No policies at all on shipping_credentials for authenticated -- RLS
-- default-denies every operation with zero policies defined, and there's no
-- grant to reach it anyway (belt-and-suspenders, matching marketplace_credentials).

-- Creating a label is a normal fulfillment task, not an account-connection
-- action -- is_store_member, not owner-gated.
create policy shipments_select on public.shipments
  for select using (public.is_store_member(store_id));
create policy shipments_insert on public.shipments
  for insert with check (public.is_store_member(store_id));
create policy shipments_update on public.shipments
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

-- Extends Module #9's webhook dedup table for Shippo's tracking-update
-- webhooks, same pattern as the payments.method constraint extension in
-- the Buylist migration.
alter table public.processed_webhook_events drop constraint processed_webhook_events_source_check;
alter table public.processed_webhook_events add constraint processed_webhook_events_source_check
  check (source in ('shopify', 'stripe', 'shippo'));

-- marketplace_orders was deliberately grant-locked to service_role-only
-- writes in Module #9 (staff were read-only; only the webhook/poll
-- pipeline mutated it). create_shipment below is NOT security definer, so
-- it runs as the calling (authenticated) role -- it needs its own grant +
-- policy to flip status to 'fulfilled', the same "missing grant" bug class
-- this project has hit before, this time surfaced by a legitimate new
-- staff-initiated write path onto a table that used to have none.
grant update on public.marketplace_orders to authenticated;
create policy marketplace_orders_update on public.marketplace_orders
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

-- Atomic: label purchase + marking the order fulfilled must not be two
-- separate client-driven calls that can partially fail. Not security
-- definer, same reasoning as complete_order/import_marketplace_order --
-- RLS still applies internally.
create function public.create_shipment(
  p_marketplace_order_id uuid,
  p_shippo_shipment_id text,
  p_shippo_transaction_id text,
  p_tracking_number text,
  p_tracking_url text,
  p_label_url text,
  p_carrier_name text,
  p_service_level text,
  p_rate_cents integer
)
returns uuid
language plpgsql
as $$
declare
  v_shipment_id uuid;
  v_store_id uuid;
begin
  select store_id into v_store_id from public.marketplace_orders where id = p_marketplace_order_id;
  if v_store_id is null then
    raise exception 'Marketplace order not found';
  end if;

  insert into public.shipments (
    store_id, marketplace_order_id, shippo_shipment_id, shippo_transaction_id,
    tracking_number, tracking_url, label_url, carrier_name, service_level, rate_cents
  )
  values (
    v_store_id, p_marketplace_order_id, p_shippo_shipment_id, p_shippo_transaction_id,
    p_tracking_number, p_tracking_url, p_label_url, p_carrier_name, p_service_level, p_rate_cents
  )
  returning id into v_shipment_id;

  update public.marketplace_orders set status = 'fulfilled' where id = p_marketplace_order_id;

  return v_shipment_id;
end;
$$;

grant execute on function public.create_shipment(uuid, text, text, text, text, text, text, text, integer) to authenticated;

-- Realtime: the queue can live-update when a label is purchased from
-- another screen, same pattern as every prior module's Realtime table.
alter publication supabase_realtime add table public.shipments;
