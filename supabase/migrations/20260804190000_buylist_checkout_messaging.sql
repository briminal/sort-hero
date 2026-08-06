-- Buylist Phase 5: checkout configuration messaging.
--
-- Lets a store configure the messaging customers see on the public buylist
-- portal at checkout: a general banner, per-payout-channel incentive copy
-- (e.g. highlighting that store credit pays more than cash, now that
-- Phase 2 supports genuinely different cash/credit offers), and an optional
-- terms-acceptance gate before submission. One row per store -- reads go
-- through the service-role client from the anonymous portal (same pattern
-- as every other portal-facing table), writes are staff-only via RLS.

create table public.buylist_checkout_config (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(id),
  checkout_message text,
  cash_incentive_message text,
  credit_incentive_message text,
  terms_text text,
  require_terms_acceptance boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger buylist_checkout_config_set_updated_at
before update on public.buylist_checkout_config
for each row execute function public.set_updated_at();

grant select, insert, update on public.buylist_checkout_config to authenticated;
grant select on public.buylist_checkout_config to service_role;

alter table public.buylist_checkout_config enable row level security;

create policy buylist_checkout_config_select on public.buylist_checkout_config
  for select using (public.is_store_member(store_id));
create policy buylist_checkout_config_insert on public.buylist_checkout_config
  for insert with check (public.is_store_member(store_id));
create policy buylist_checkout_config_update on public.buylist_checkout_config
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

-- One row per store -- staff always "save" via upsert on store_id rather
-- than juggling insert-vs-update in application code.
create function public.upsert_buylist_checkout_config(
  p_store_id uuid,
  p_checkout_message text,
  p_cash_incentive_message text,
  p_credit_incentive_message text,
  p_terms_text text,
  p_require_terms_acceptance boolean
)
returns void
language plpgsql
as $$
begin
  insert into public.buylist_checkout_config (
    store_id, checkout_message, cash_incentive_message, credit_incentive_message, terms_text, require_terms_acceptance
  )
  values (p_store_id, p_checkout_message, p_cash_incentive_message, p_credit_incentive_message, p_terms_text, p_require_terms_acceptance)
  on conflict (store_id) do update set
    checkout_message = excluded.checkout_message,
    cash_incentive_message = excluded.cash_incentive_message,
    credit_incentive_message = excluded.credit_incentive_message,
    terms_text = excluded.terms_text,
    require_terms_acceptance = excluded.require_terms_acceptance;
end;
$$;

grant execute on function public.upsert_buylist_checkout_config(uuid, text, text, text, text, boolean) to authenticated;
