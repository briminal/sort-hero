-- POS parity pass, phase 1 (tax & discounts): stores get a default tax
-- rate + optional rounding increment; orders/order_items gain the columns
-- needed to actually charge tax and apply a cart-level discount, none of
-- which existed before this (orders only ever had subtotal_cents/
-- total_cents with total always == subtotal).
alter table public.stores
  add column tax_rate_percent numeric(5,2) not null default 0 check (tax_rate_percent >= 0 and tax_rate_percent <= 100),
  add column round_to_nearest_cents integer check (round_to_nearest_cents is null or round_to_nearest_cents > 0);

alter table public.orders
  add column tax_cents integer not null default 0,
  add column discount_cents integer not null default 0,
  add column tax_exempt boolean not null default false;

alter table public.order_items
  add column taxable boolean not null default true;

-- complete_order's own total-vs-paid check is unaffected (it already just
-- compares total_cents, which now correctly includes tax/discount since
-- createOrder computes it that way) -- no RPC change needed here.
