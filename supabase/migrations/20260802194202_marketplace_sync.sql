-- Marketplace Sync: push local inventory as Shopify/TCGplayer listings, pull
-- orders placed there back into the shop's system. First module needing
-- third-party credential storage -- since Postgres RLS is row-level, not
-- column-level, secrets are split into their own table with NO grant to
-- authenticated at all (only service_role), rather than relying on a policy
-- to hide a column. Every Server Action that touches marketplace_credentials
-- must do its own is_store_owner check before using the service-role client,
-- since there's no RLS policy here to lean on.

create table public.marketplace_connections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  platform text not null check (platform in ('shopify', 'tcgplayer')),
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  shop_domain text,
  tcgplayer_store_key text,
  last_synced_at timestamptz,
  last_error text,
  auto_sync_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, platform)
);

create index marketplace_connections_store_id_idx on public.marketplace_connections(store_id);

create trigger marketplace_connections_set_updated_at
before update on public.marketplace_connections
for each row execute function public.set_updated_at();

create table public.marketplace_credentials (
  connection_id uuid primary key references public.marketplace_connections(id) on delete cascade,
  shopify_access_token text,
  shopify_webhook_secret text,
  tcgplayer_api_key text,
  tcgplayer_api_secret text,
  tcgplayer_bearer_token text,
  tcgplayer_bearer_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- TCGplayer's product catalog ID is shared/global (like cards.external_id
-- from Scryfall), not per-store, so it's cached directly on cards rather
-- than in a per-store mapping table.
alter table public.cards add column tcgplayer_product_id text;
create index cards_tcgplayer_product_id_idx on public.cards(tcgplayer_product_id) where tcgplayer_product_id is not null;

create table public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  connection_id uuid not null references public.marketplace_connections(id),
  platform text not null check (platform in ('shopify', 'tcgplayer')),
  external_listing_id text,
  external_product_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'error', 'delisted')),
  last_pushed_price_cents integer,
  last_pushed_quantity integer,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_item_id, platform)
);

create index marketplace_listings_store_id_idx on public.marketplace_listings(store_id);
create index marketplace_listings_connection_id_idx on public.marketplace_listings(connection_id);
create index marketplace_listings_inventory_item_idx on public.marketplace_listings(inventory_item_id);

create trigger marketplace_listings_set_updated_at
before update on public.marketplace_listings
for each row execute function public.set_updated_at();

-- Sibling to orders/order_items, not a reuse -- orders.till_id is not null
-- (POS-specific). Same snapshot pattern (card_name duplicated onto the
-- line item so history survives inventory edits/deletes).
create table public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  connection_id uuid not null references public.marketplace_connections(id),
  platform text not null check (platform in ('shopify', 'tcgplayer')),
  external_order_id text not null,
  status text not null default 'pending' check (status in ('pending', 'fulfilled', 'cancelled', 'refunded')),
  subtotal_cents integer not null,
  total_cents integer not null,
  customer_name text,
  customer_email text,
  shipping_address jsonb,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_order_id)
);

create index marketplace_orders_store_id_idx on public.marketplace_orders(store_id);

create trigger marketplace_orders_set_updated_at
before update on public.marketplace_orders
for each row execute function public.set_updated_at();

create table public.marketplace_order_items (
  id uuid primary key default gen_random_uuid(),
  marketplace_order_id uuid not null references public.marketplace_orders(id),
  inventory_item_id uuid references public.inventory_items(id),
  card_id uuid not null references public.cards(id),
  card_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null,
  line_total_cents integer not null
);

create index marketplace_order_items_order_id_idx on public.marketplace_order_items(marketplace_order_id);

-- Webhook dedup, built for real for the first time (CLAUDE.md's
-- processed_webhook_events pattern). service_role only -- webhook requests
-- have no user session.
create table public.processed_webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('shopify', 'stripe')),
  event_id text not null,
  received_at timestamptz not null default now(),
  unique (source, event_id)
);

-- Cron overlap guard + audit trail. See start_sync_job_run below for how
-- "only one running row per store+job_type" is enforced atomically, and
-- why a session-level Postgres advisory lock does NOT work here.
create table public.sync_job_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  job_type text not null check (job_type in ('push_listings', 'pull_orders', 'refresh_tcgplayer_token')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  items_processed integer default 0
);

create index sync_job_runs_store_job_idx on public.sync_job_runs(store_id, job_type, started_at desc);

-- Grants (RLS restricts rows, not table access -- both needed, same lesson
-- applied in every prior migration this project).
grant select, insert, update on public.marketplace_connections to authenticated;
grant select, insert, update on public.marketplace_connections to service_role;
-- Deliberately no grant to authenticated on marketplace_credentials.
grant select, insert, update on public.marketplace_credentials to service_role;
grant select, insert, update on public.marketplace_listings to authenticated;
grant select, insert, update on public.marketplace_listings to service_role;
-- marketplace_orders/marketplace_order_items: staff read-only, only the
-- webhook/poll pipeline (service_role) writes.
grant select on public.marketplace_orders to authenticated;
grant select, insert, update on public.marketplace_orders to service_role;
grant select on public.marketplace_order_items to authenticated;
grant select, insert on public.marketplace_order_items to service_role;
grant select, insert on public.processed_webhook_events to service_role;
grant select on public.sync_job_runs to authenticated;
grant select, insert, update on public.sync_job_runs to service_role;

alter table public.marketplace_connections enable row level security;
alter table public.marketplace_credentials enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_orders enable row level security;
alter table public.marketplace_order_items enable row level security;
alter table public.processed_webhook_events enable row level security;
alter table public.sync_job_runs enable row level security;

create policy marketplace_connections_select on public.marketplace_connections
  for select using (public.is_store_member(store_id));
-- Connecting a marketplace means writing credentials -- owner-only, same
-- sensitivity tier as inventory delete.
create policy marketplace_connections_insert on public.marketplace_connections
  for insert with check (public.is_store_owner(store_id));
create policy marketplace_connections_update on public.marketplace_connections
  for update using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));

-- No policies at all on marketplace_credentials for authenticated -- RLS
-- default-denies every operation with zero policies defined, and there's no
-- grant to reach it anyway (belt-and-suspenders, matching the buylist
-- portal's "no anon grants anywhere" precedent).

create policy marketplace_listings_select on public.marketplace_listings
  for select using (public.is_store_member(store_id));
create policy marketplace_listings_insert on public.marketplace_listings
  for insert with check (public.is_store_member(store_id));
create policy marketplace_listings_update on public.marketplace_listings
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

create policy marketplace_orders_select on public.marketplace_orders
  for select using (public.is_store_member(store_id));

create policy marketplace_order_items_select on public.marketplace_order_items
  for select using (
    exists (select 1 from public.marketplace_orders o where o.id = marketplace_order_items.marketplace_order_id and public.is_store_member(o.store_id))
  );

-- No policies for authenticated on processed_webhook_events -- service_role
-- only, not client-facing data at all.

create policy sync_job_runs_select on public.sync_job_runs
  for select using (public.is_store_member(store_id));

-- Overlap guard: a row-based lock, not a Postgres session-level advisory
-- lock. Advisory locks are tied to the underlying DB *connection*, but
-- every call here goes through Supabase's pooled PostgREST/RPC interface --
-- two calls from "the same" JS client are not guaranteed to land on the
-- same physical connection, so pg_advisory_lock/pg_advisory_unlock cannot
-- be relied on to actually hold across a job's lifetime in this
-- architecture (confirmed by this module's own verification catching it).
-- A partial unique index makes "only one running row per store+job_type"
-- an atomic guarantee enforced by Postgres itself, independent of which
-- connection any given call happens to use.
create unique index sync_job_runs_one_running_idx
  on public.sync_job_runs(store_id, job_type)
  where status = 'running';

-- Starts a job run, or returns null if one is already in flight. Also
-- reclaims a stale "running" row left behind by a crashed Edge Function
-- invocation (no release_sync_lock equivalent is needed: the fix for "stuck
-- forever" is time-based staleness, not connection-lifetime, since there's
-- no connection to tie a release to here) before checking the index.
create function public.start_sync_job_run(p_store_id uuid, p_job_type text)
returns uuid
language plpgsql
as $$
declare
  v_run_id uuid;
begin
  update public.sync_job_runs
  set status = 'failed', error = 'stale, presumed crashed', finished_at = now()
  where store_id = p_store_id
    and job_type = p_job_type
    and status = 'running'
    and started_at < now() - interval '30 minutes';

  insert into public.sync_job_runs (store_id, job_type)
  values (p_store_id, p_job_type)
  on conflict (store_id, job_type) where status = 'running' do nothing
  returning id into v_run_id;

  return v_run_id;
end;
$$;

grant execute on function public.start_sync_job_run(uuid, text) to service_role;

-- Atomic inbound-order import. Idempotent via ON CONFLICT DO NOTHING on
-- (connection_id, external_order_id) -- a retried webhook or a poll that
-- re-sees an already-imported order is a no-op that returns the existing
-- order id, not an error. Locks inventory rows in inventory_item_id order
-- (same deadlock-avoidance reasoning as complete_order's bugfix pass).
--
-- Deliberately diverges from complete_order's "raise loudly on insufficient
-- stock": complete_order runs BEFORE a sale is committed, so aborting is
-- safe and correct. A marketplace order arrives AFTER the sale already
-- happened on the platform's side -- refusing to record it would just make
-- a real sale invisible. This clamps the decrement at zero and flags
-- oversold_warning in raw_payload for staff to reconcile, instead.
--
-- Not security definer, same reasoning as every other RPC in this project --
-- called via the service-role client from the webhook/job path, so RLS is
-- already bypassed at the connection level; this only adds atomicity.
create function public.import_marketplace_order(
  p_store_id uuid,
  p_connection_id uuid,
  p_platform text,
  p_external_order_id text,
  p_subtotal_cents integer,
  p_total_cents integer,
  p_customer_name text,
  p_customer_email text,
  p_shipping_address jsonb,
  p_raw_payload jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_available integer;
  v_inventory_item_id uuid;
  v_oversold boolean := false;
begin
  insert into public.marketplace_orders (
    store_id, connection_id, platform, external_order_id,
    subtotal_cents, total_cents, customer_name, customer_email,
    shipping_address, raw_payload
  )
  values (
    p_store_id, p_connection_id, p_platform, p_external_order_id,
    p_subtotal_cents, p_total_cents, p_customer_name, p_customer_email,
    p_shipping_address, p_raw_payload
  )
  on conflict (connection_id, external_order_id) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select id into v_order_id from public.marketplace_orders
    where connection_id = p_connection_id and external_order_id = p_external_order_id;
    return v_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) order by (value->>'inventoryItemId')
  loop
    v_inventory_item_id := nullif(v_item->>'inventoryItemId', '')::uuid;

    insert into public.marketplace_order_items (
      marketplace_order_id, inventory_item_id, card_id, card_name,
      quantity, unit_price_cents, line_total_cents
    )
    values (
      v_order_id, v_inventory_item_id, (v_item->>'cardId')::uuid, v_item->>'cardName',
      (v_item->>'quantity')::integer, (v_item->>'unitPriceCents')::integer, (v_item->>'lineTotalCents')::integer
    );

    if v_inventory_item_id is not null then
      select quantity into v_available from public.inventory_items where id = v_inventory_item_id for update;

      if v_available is not null then
        update public.inventory_items
        set quantity = greatest(0, quantity - (v_item->>'quantity')::integer)
        where id = v_inventory_item_id;

        if v_available < (v_item->>'quantity')::integer then
          v_oversold := true;
        end if;
      else
        v_oversold := true;
      end if;
    end if;
  end loop;

  if v_oversold then
    update public.marketplace_orders
    set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('oversold_warning', true)
    where id = v_order_id;
  end if;

  return v_order_id;
end;
$$;

grant execute on function public.import_marketplace_order(uuid, uuid, text, text, integer, integer, text, text, jsonb, jsonb, jsonb) to service_role;

-- Realtime: settings UI's "sync now" status and an eventual orders queue
-- view both want live push, per CLAUDE.md -- same reasoning as tills/
-- buylist_submissions.
alter publication supabase_realtime add table public.marketplace_orders;
alter publication supabase_realtime add table public.sync_job_runs;
