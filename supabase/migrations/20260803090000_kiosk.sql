-- Kiosk (Module #12): PIN-gated, read-only customer inventory browser.
-- PIN auth is a separate, lower-trust session scope from Supabase Auth --
-- these tables/functions are never reachable via anon/authenticated grants,
-- only via the service-role client from src/app/(public)/kiosk Server
-- Actions and src/app/(dashboard)/settings/kiosk Server Actions.

create extension if not exists pgcrypto;

-- Pre-existing gap found while building this module: stores_and_auth.sql
-- only ever granted service_role no privileges at all on public.stores
-- (only `authenticated` got select/insert/update/delete). Every
-- service-role store lookup by slug -- resolveStoreId() in the (already
-- copied) buylist-portal pattern, and this module's kiosk page/actions --
-- was silently broken by this: not an RLS denial (service_role bypasses
-- RLS) but a bare permission-denied at the table-grant layer, which is a
-- separate check. Kiosk needs this to resolve a store by slug for an
-- anonymous customer, so fixing it here rather than leaving it latent.
grant select on public.stores to service_role;

create table public.kiosk_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

create trigger kiosk_settings_set_updated_at
before update on public.kiosk_settings
for each row execute function public.set_updated_at();

grant select, insert, update on public.kiosk_settings to authenticated;
grant select, insert, update on public.kiosk_settings to service_role;

alter table public.kiosk_settings enable row level security;

-- Staff can see whether a PIN is configured (never the hash itself is
-- exposed to the client -- the settings page selects pin_hash is not null,
-- not pin_hash). Only owners may set/rotate it. No delete policy --
-- deny-by-default; there's no product need to remove kiosk config entirely.
create policy kiosk_settings_select on public.kiosk_settings
  for select
  using (public.is_store_member(store_id));

create policy kiosk_settings_insert on public.kiosk_settings
  for insert
  with check (public.is_store_owner(store_id));

create policy kiosk_settings_update on public.kiosk_settings
  for update
  using (public.is_store_owner(store_id))
  with check (public.is_store_owner(store_id));

-- Rate-limit state for PIN attempts. Deliberately zero RLS policies (not
-- even for staff) -- this table is only ever touched from inside the
-- SECURITY DEFINER kiosk_verify_pin function below, which runs as the
-- function owner and bypasses RLS. Grant is service_role-only as
-- defense-in-depth, even though it's unreachable via PostgREST either way
-- since nothing grants authenticated/anon access to it.
create table public.kiosk_pin_attempts (
  store_id uuid primary key references public.stores(id) on delete cascade,
  consecutive_failures integer not null default 0,
  locked_until timestamptz,
  last_attempt_at timestamptz
);

alter table public.kiosk_pin_attempts enable row level security;

grant select, insert, update on public.kiosk_pin_attempts to service_role;

-- Sets (or rotates) a store's kiosk PIN, hashed via pgcrypto's bcrypt.
-- Resets any existing lockout -- changing the PIN is a legitimate reason to
-- forgive prior failed attempts. Caller (the settings Server Action) is
-- responsible for the owner-role check before invoking this; this function
-- itself trusts its caller the same way shipping_credentials writes do.
create function public.set_kiosk_pin(p_store_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.kiosk_settings (store_id, pin_hash)
  values (p_store_id, crypt(p_pin, gen_salt('bf')))
  on conflict (store_id) do update set pin_hash = excluded.pin_hash, updated_at = now();

  delete from public.kiosk_pin_attempts where store_id = p_store_id;
end;
$$;

grant execute on function public.set_kiosk_pin(uuid, text) to service_role;

-- Verifies a PIN attempt with a row-locked, atomic rate-limit check: 5
-- consecutive failures locks the store's kiosk out for 15 minutes. A
-- lockout wins over a correct PIN typed after the limit is hit -- otherwise
-- the lockout would be trivially bypassable by just knowing the real PIN,
-- which defeats the point of throttling brute-force guesses.
create function public.kiosk_verify_pin(p_store_id uuid, p_pin text)
returns table (ok boolean, locked_until timestamptz, attempts_remaining int)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pin_hash text;
  v_failures int;
  v_locked_until timestamptz;
begin
  insert into public.kiosk_pin_attempts (store_id)
  values (p_store_id)
  on conflict (store_id) do nothing;

  select consecutive_failures, kiosk_pin_attempts.locked_until
    into v_failures, v_locked_until
    from public.kiosk_pin_attempts
    where store_id = p_store_id
    for update;

  if v_locked_until is not null and v_locked_until > now() then
    return query select false, v_locked_until, 0;
    return;
  end if;

  select kiosk_settings.pin_hash into v_pin_hash
    from public.kiosk_settings
    where kiosk_settings.store_id = p_store_id;

  if v_pin_hash is not null and crypt(p_pin, v_pin_hash) = v_pin_hash then
    update public.kiosk_pin_attempts
      set consecutive_failures = 0, locked_until = null, last_attempt_at = now()
      where store_id = p_store_id;
    return query select true, null::timestamptz, 5;
    return;
  end if;

  v_failures := coalesce(v_failures, 0) + 1;

  if v_failures >= 5 then
    update public.kiosk_pin_attempts
      set consecutive_failures = v_failures, locked_until = now() + interval '15 minutes', last_attempt_at = now()
      where store_id = p_store_id;
    return query select false, (now() + interval '15 minutes'), 0;
    return;
  end if;

  update public.kiosk_pin_attempts
    set consecutive_failures = v_failures, last_attempt_at = now()
    where store_id = p_store_id;
  return query select false, null::timestamptz, (5 - v_failures);
end;
$$;

grant execute on function public.kiosk_verify_pin(uuid, text) to service_role;

-- Public-safe, read-only inventory browse for an unlocked kiosk session.
-- Deliberately excludes notes/scanned_image_url/cost -- nothing beyond
-- condition/quantity/price_cents and card display fields is customer-safe.
-- Only confirmed, in-stock items are visible (staged items aren't real
-- available stock yet).
create function public.kiosk_browse_inventory(
  p_store_id uuid,
  p_game_code text default null,
  p_query text default null,
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  inventory_item_id uuid,
  card_id uuid,
  card_name text,
  set_name text,
  rarity text,
  image_url text,
  condition text,
  quantity int,
  price_cents int
)
language sql
stable
as $$
  select
    i.id as inventory_item_id,
    c.id as card_id,
    c.name as card_name,
    s.name as set_name,
    c.rarity,
    c.image_url,
    i.condition,
    i.quantity,
    i.price_cents
  from public.inventory_items i
  join public.cards c on c.id = i.card_id
  join public.games g on g.id = c.game_id
  left join public.sets s on s.id = c.set_id
  where i.store_id = p_store_id
    and i.status = 'confirmed'
    and i.quantity > 0
    and (p_game_code is null or g.code = p_game_code)
    and (p_query is null or c.name % p_query)
  order by
    case when p_query is not null then similarity(c.name, p_query) end desc nulls last,
    c.name
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.kiosk_browse_inventory(uuid, text, text, int, int) to service_role;
