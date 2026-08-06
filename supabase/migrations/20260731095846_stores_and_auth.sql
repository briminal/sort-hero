-- Stores & multi-tenant membership, with RLS enabled and deny-by-default.

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'cashier')),
  created_at timestamptz not null default now(),
  unique (store_id, user_id)
);

create index store_members_user_id_idx on public.store_members(user_id);
create index store_members_store_id_idx on public.store_members(store_id);

-- updated_at trigger, reusable across tables.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger stores_set_updated_at
before update on public.stores
for each row execute function public.set_updated_at();

-- SECURITY DEFINER helpers so RLS policies on store_members don't recurse
-- into themselves (a plain self-referencing policy on store_members causes
-- "infinite recursion detected in policy" in Postgres).
create function public.is_store_member(p_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.store_members
    where store_id = p_store_id and user_id = auth.uid()
  );
$$;

create function public.is_store_owner(p_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.store_members
    where store_id = p_store_id and user_id = auth.uid() and role = 'owner'
  );
$$;

grant execute on function public.is_store_member(uuid) to authenticated;
grant execute on function public.is_store_owner(uuid) to authenticated;

-- Atomically create a store and its owner membership row. This is the only
-- path that creates a store or an 'owner' store_members row -- there is no
-- direct insert policy for either, so a signup can never end up with a
-- store and no owner (or an owner row with no store).
create function public.create_store_with_owner(store_name text, store_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_store_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.stores (name, slug)
  values (store_name, store_slug)
  returning id into new_store_id;

  insert into public.store_members (store_id, user_id, role)
  values (new_store_id, auth.uid(), 'owner');

  return new_store_id;
end;
$$;

grant execute on function public.create_store_with_owner(text, text) to authenticated;

-- RLS policies restrict *rows*, not the underlying table grant -- without
-- these, PostgREST gets a bare "permission denied" before RLS even applies.
grant select, insert, update, delete on public.stores to authenticated;
grant select, insert, update, delete on public.store_members to authenticated;

alter table public.stores enable row level security;
alter table public.store_members enable row level security;

-- stores: members can read their store; only owners can update/delete it.
-- No insert policy -- creation only happens via create_store_with_owner.
create policy stores_select on public.stores
  for select
  using (public.is_store_member(id));

create policy stores_update on public.stores
  for update
  using (public.is_store_owner(id))
  with check (public.is_store_owner(id));

create policy stores_delete on public.stores
  for delete
  using (public.is_store_owner(id));

-- store_members: members can see fellow members of their store; only
-- owners can manage membership. The initial owner row is only created via
-- create_store_with_owner, which bypasses RLS as a SECURITY DEFINER function.
create policy store_members_select on public.store_members
  for select
  using (public.is_store_member(store_id));

create policy store_members_insert on public.store_members
  for insert
  with check (public.is_store_owner(store_id));

create policy store_members_update on public.store_members
  for update
  using (public.is_store_owner(store_id))
  with check (public.is_store_owner(store_id));

create policy store_members_delete on public.store_members
  for delete
  using (public.is_store_owner(store_id));
