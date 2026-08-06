-- Buylist: portal cart + checkout parity pass.
--
-- The public portal was a plain search-and-add list with one payout method
-- chosen for the whole submission. Bringing it in line with the reference
-- flow: customers browse a card grid, pick condition/printing/language and
-- a CASH-OR-CREDIT payout per line (not just per submission), attach a note
-- per card, and checkout collects a drop-in-vs-delivery fulfillment choice,
-- a payment account, and order notes.

alter table public.buylist_items add column payout_type text not null default 'cash' check (payout_type in ('cash', 'credit'));
alter table public.buylist_items add column printing text not null default 'normal';
alter table public.buylist_items add column language text not null default 'EN';
alter table public.buylist_items add column customer_notes text;

alter table public.buylist_submissions add column fulfillment_method text check (fulfillment_method in ('drop_in', 'delivery'));
alter table public.buylist_submissions add column payment_account text;
alter table public.buylist_submissions add column order_notes text;

alter table public.buylist_checkout_config add column drop_in_enabled boolean not null default true;
alter table public.buylist_checkout_config add column drop_in_message text;
alter table public.buylist_checkout_config add column delivery_enabled boolean not null default true;
alter table public.buylist_checkout_config add column delivery_message text;
alter table public.buylist_checkout_config add column address_acknowledgment_message text;

-- Signature changed (5 new params) -- drop the old one first, same
-- reasoning as every other RPC signature change in this project.
drop function if exists public.upsert_buylist_checkout_config(uuid, text, text, text, text, boolean);

create function public.upsert_buylist_checkout_config(
  p_store_id uuid,
  p_checkout_message text,
  p_cash_incentive_message text,
  p_credit_incentive_message text,
  p_terms_text text,
  p_require_terms_acceptance boolean,
  p_drop_in_enabled boolean,
  p_drop_in_message text,
  p_delivery_enabled boolean,
  p_delivery_message text,
  p_address_acknowledgment_message text
)
returns void
language plpgsql
as $$
begin
  insert into public.buylist_checkout_config (
    store_id, checkout_message, cash_incentive_message, credit_incentive_message, terms_text, require_terms_acceptance,
    drop_in_enabled, drop_in_message, delivery_enabled, delivery_message, address_acknowledgment_message
  )
  values (
    p_store_id, p_checkout_message, p_cash_incentive_message, p_credit_incentive_message, p_terms_text, p_require_terms_acceptance,
    p_drop_in_enabled, p_drop_in_message, p_delivery_enabled, p_delivery_message, p_address_acknowledgment_message
  )
  on conflict (store_id) do update set
    checkout_message = excluded.checkout_message,
    cash_incentive_message = excluded.cash_incentive_message,
    credit_incentive_message = excluded.credit_incentive_message,
    terms_text = excluded.terms_text,
    require_terms_acceptance = excluded.require_terms_acceptance,
    drop_in_enabled = excluded.drop_in_enabled,
    drop_in_message = excluded.drop_in_message,
    delivery_enabled = excluded.delivery_enabled,
    delivery_message = excluded.delivery_message,
    address_acknowledgment_message = excluded.address_acknowledgment_message;
end;
$$;

grant execute on function public.upsert_buylist_checkout_config(uuid, text, text, text, text, boolean, boolean, text, boolean, text, text) to authenticated;
