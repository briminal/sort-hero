-- Buylist: customers sell cards to the shop, either remotely via the public
-- portal or in-person at POS ("buy mode", absorbed here from the POS
-- module). Staff-facing tables use the usual is_store_member/is_store_owner
-- RLS; the public portal never talks to these tables directly -- it goes
-- through service-role-backed Server Actions instead (see plan), since
-- is_store_member has no way to authorize "the customer who submitted this."
-- No anon grants anywhere in this file.

create table public.buylist_customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  name text,
  email text,
  phone text,
  store_credit_balance_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index buylist_customers_store_email_idx
  on public.buylist_customers(store_id, email) where email is not null;
create index buylist_customers_store_id_idx on public.buylist_customers(store_id);

create table public.buylist_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  step_order integer not null,
  rule_type text not null check (rule_type in (
    'condition_multiplier', 'margin_percent', 'margin_fixed',
    'round_to_nearest', 'min_price', 'max_price'
  )),
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true
);

create index buylist_pricing_rules_store_id_idx on public.buylist_pricing_rules(store_id);

create table public.buylist_submissions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  customer_id uuid not null references public.buylist_customers(id),
  channel text not null check (channel in ('portal', 'pos')),
  status text not null default 'pending' check (status in (
    'pending', 'priced', 'accepted', 'declined', 'completed', 'cancelled'
  )),
  access_token uuid not null default gen_random_uuid() unique,
  payout_method text check (payout_method in ('cash', 'store_credit')),
  total_offer_cents integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index buylist_submissions_store_id_idx on public.buylist_submissions(store_id);
create index buylist_submissions_customer_id_idx on public.buylist_submissions(customer_id);

create trigger buylist_submissions_set_updated_at
before update on public.buylist_submissions
for each row execute function public.set_updated_at();

create table public.buylist_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.buylist_submissions(id),
  card_id uuid not null references public.cards(id),
  card_name text not null,
  condition text not null check (condition in ('NM', 'LP', 'MP', 'HP', 'DMG')),
  quantity_submitted integer not null check (quantity_submitted > 0),
  quantity_approved integer,
  offered_unit_price_cents integer not null,
  created_at timestamptz not null default now()
);

create index buylist_items_submission_id_idx on public.buylist_items(submission_id);

-- Chat between staff and customer for a submission -- append-only.
create table public.buylist_messages (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.buylist_submissions(id),
  sender text not null check (sender in ('customer', 'staff')),
  body text not null,
  created_at timestamptz not null default now()
);

create index buylist_messages_submission_id_idx on public.buylist_messages(submission_id);

-- Audit ledger for every store-credit balance change -- append-only, per
-- CLAUDE.md's requirement that sensitive mutations get an audit trail.
create table public.store_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  customer_id uuid not null references public.buylist_customers(id),
  amount_cents integer not null,
  reason text,
  submission_id uuid references public.buylist_submissions(id),
  order_id uuid references public.orders(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index store_credit_transactions_customer_id_idx on public.store_credit_transactions(customer_id);

-- Grants (RLS restricts rows, not table access -- both are needed, same
-- lesson applied in every prior migration this project).
grant select, insert, update on public.buylist_customers to authenticated;
grant select, insert, update on public.buylist_customers to service_role;
grant select, insert, update, delete on public.buylist_pricing_rules to authenticated;
grant select, insert, update, delete on public.buylist_pricing_rules to service_role;
grant select, insert, update on public.buylist_submissions to authenticated;
grant select, insert, update on public.buylist_submissions to service_role;
grant select, insert, update on public.buylist_items to authenticated;
grant select, insert, update on public.buylist_items to service_role;
grant select, insert on public.buylist_messages to authenticated;
grant select, insert on public.buylist_messages to service_role;
grant select, insert on public.store_credit_transactions to authenticated;
grant select, insert on public.store_credit_transactions to service_role;

alter table public.buylist_customers enable row level security;
alter table public.buylist_pricing_rules enable row level security;
alter table public.buylist_submissions enable row level security;
alter table public.buylist_items enable row level security;
alter table public.buylist_messages enable row level security;
alter table public.store_credit_transactions enable row level security;

create policy buylist_customers_select on public.buylist_customers
  for select using (public.is_store_member(store_id));
create policy buylist_customers_insert on public.buylist_customers
  for insert with check (public.is_store_member(store_id));
create policy buylist_customers_update on public.buylist_customers
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

create policy buylist_pricing_rules_select on public.buylist_pricing_rules
  for select using (public.is_store_member(store_id));
create policy buylist_pricing_rules_insert on public.buylist_pricing_rules
  for insert with check (public.is_store_member(store_id));
create policy buylist_pricing_rules_update on public.buylist_pricing_rules
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));
create policy buylist_pricing_rules_delete on public.buylist_pricing_rules
  for delete using (public.is_store_member(store_id));

create policy buylist_submissions_select on public.buylist_submissions
  for select using (public.is_store_member(store_id));
create policy buylist_submissions_insert on public.buylist_submissions
  for insert with check (public.is_store_member(store_id));
create policy buylist_submissions_update on public.buylist_submissions
  for update using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

-- buylist_items/buylist_messages/store_credit_transactions have no direct
-- store_id -- scoped via their parent submission's store, same pattern as
-- order_items/payments/refunds in the POS migration.
create policy buylist_items_select on public.buylist_items
  for select using (
    exists (select 1 from public.buylist_submissions s where s.id = buylist_items.submission_id and public.is_store_member(s.store_id))
  );
create policy buylist_items_insert on public.buylist_items
  for insert with check (
    exists (select 1 from public.buylist_submissions s where s.id = buylist_items.submission_id and public.is_store_member(s.store_id))
  );
create policy buylist_items_update on public.buylist_items
  for update
  using (exists (select 1 from public.buylist_submissions s where s.id = buylist_items.submission_id and public.is_store_member(s.store_id)))
  with check (exists (select 1 from public.buylist_submissions s where s.id = buylist_items.submission_id and public.is_store_member(s.store_id)));

create policy buylist_messages_select on public.buylist_messages
  for select using (
    exists (select 1 from public.buylist_submissions s where s.id = buylist_messages.submission_id and public.is_store_member(s.store_id))
  );
create policy buylist_messages_insert on public.buylist_messages
  for insert with check (
    exists (select 1 from public.buylist_submissions s where s.id = buylist_messages.submission_id and public.is_store_member(s.store_id))
  );

create policy store_credit_transactions_select on public.store_credit_transactions
  for select using (public.is_store_member(store_id));
create policy store_credit_transactions_insert on public.store_credit_transactions
  for insert with check (public.is_store_member(store_id));

-- Replaces a store's entire buy-side rule set atomically, identical
-- reasoning/shape to replace_pricing_rules in the autopricing migration.
create function public.replace_buylist_pricing_rules(p_store_id uuid, p_rules jsonb)
returns void
language plpgsql
as $$
begin
  delete from public.buylist_pricing_rules where store_id = p_store_id;

  insert into public.buylist_pricing_rules (store_id, step_order, rule_type, config, enabled)
  select
    p_store_id,
    (rule->>'stepOrder')::integer,
    rule->>'ruleType',
    coalesce(rule->'config', '{}'::jsonb),
    coalesce((rule->>'enabled')::boolean, true)
  from jsonb_array_elements(p_rules) as rule;
end;
$$;

grant execute on function public.replace_buylist_pricing_rules(uuid, jsonb) to authenticated;

-- Staff sets/overrides the offer price and approved quantity per line,
-- computes the submission total, and moves it to 'priced' (awaiting the
-- customer's accept/decline via the portal).
create function public.price_buylist_submission(p_submission_id uuid, p_items jsonb)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_total integer;
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    update public.buylist_items
    set
      quantity_approved = (v_item->>'quantityApproved')::integer,
      offered_unit_price_cents = (v_item->>'offeredUnitPriceCents')::integer
    where id = (v_item->>'itemId')::uuid and submission_id = p_submission_id;
  end loop;

  select coalesce(sum(quantity_approved * offered_unit_price_cents), 0)
  into v_total
  from public.buylist_items
  where submission_id = p_submission_id;

  update public.buylist_submissions
  set status = 'priced', total_offer_cents = v_total
  where id = p_submission_id;
end;
$$;

grant execute on function public.price_buylist_submission(uuid, jsonb) to authenticated;

-- Shared internal step: creates/increments inventory for every approved
-- line, applies the payout (cash needs no bookkeeping beyond the record
-- itself; store_credit increments the customer's balance and logs an audit
-- row), and marks the submission completed. Called by both
-- approve_buylist_submission (portal: after a customer has accepted a
-- priced offer and staff physically received the cards) and create_pos_buy
-- (in-person: the whole flow happens in one step). Keeping this as a shared
-- function is what keeps those two entry points from duplicating the
-- inventory/payout logic -- same atomicity reasoning as complete_order.
create function public._apply_buylist_payout(p_submission_id uuid, p_payout_method text)
returns void
language plpgsql
as $$
declare
  v_store_id uuid;
  v_customer_id uuid;
  v_total integer;
  v_item record;
  v_existing_inventory_id uuid;
begin
  select store_id, customer_id, total_offer_cents
  into v_store_id, v_customer_id, v_total
  from public.buylist_submissions
  where id = p_submission_id;

  if v_store_id is null then
    raise exception 'Submission not found';
  end if;

  for v_item in
    select card_id, condition, quantity_approved, offered_unit_price_cents
    from public.buylist_items
    where submission_id = p_submission_id and coalesce(quantity_approved, 0) > 0
  loop
    select id into v_existing_inventory_id
    from public.inventory_items
    where store_id = v_store_id and card_id = v_item.card_id and condition = v_item.condition
    limit 1;

    if v_existing_inventory_id is not null then
      update public.inventory_items
      set quantity = quantity + v_item.quantity_approved
      where id = v_existing_inventory_id;
    else
      insert into public.inventory_items (store_id, card_id, condition, quantity, status)
      values (v_store_id, v_item.card_id, v_item.condition, v_item.quantity_approved, 'confirmed');
    end if;
  end loop;

  if p_payout_method = 'store_credit' then
    update public.buylist_customers
    set store_credit_balance_cents = store_credit_balance_cents + coalesce(v_total, 0)
    where id = v_customer_id;

    insert into public.store_credit_transactions (store_id, customer_id, amount_cents, reason, submission_id)
    values (v_store_id, v_customer_id, coalesce(v_total, 0), 'Buylist payout', p_submission_id);
  end if;

  update public.buylist_submissions
  set status = 'completed', payout_method = p_payout_method
  where id = p_submission_id;
end;
$$;

-- Portal flow: staff finalizes after the customer accepted a priced offer.
create function public.approve_buylist_submission(p_submission_id uuid, p_payout_method text)
returns void
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.buylist_submissions where id = p_submission_id for update;

  if v_status is null then
    raise exception 'Submission not found';
  end if;

  if v_status <> 'accepted' then
    raise exception 'Submission is not accepted (status: %)', v_status;
  end if;

  perform public._apply_buylist_payout(p_submission_id, p_payout_method);
end;
$$;

grant execute on function public.approve_buylist_submission(uuid, text) to authenticated;

-- In-person "buy mode" flow: creates the customer, submission, and items in
-- one step (already fully approved -- there's no separate pricing/accept
-- round trip when the customer is standing at the register), then applies
-- the same payout logic as the portal flow.
create function public.create_pos_buy(
  p_store_id uuid,
  p_customer jsonb,
  p_items jsonb,
  p_payout_method text
)
returns uuid
language plpgsql
as $$
declare
  v_customer_id uuid;
  v_submission_id uuid;
  v_item jsonb;
  v_total integer := 0;
  v_email text;
begin
  v_email := nullif(p_customer->>'email', '');

  if v_email is not null then
    select id into v_customer_id from public.buylist_customers
    where store_id = p_store_id and email = v_email;
  end if;

  if v_customer_id is null then
    insert into public.buylist_customers (store_id, name, email, phone)
    values (p_store_id, nullif(p_customer->>'name', ''), v_email, nullif(p_customer->>'phone', ''))
    returning id into v_customer_id;
  end if;

  insert into public.buylist_submissions (store_id, customer_id, channel, status)
  values (p_store_id, v_customer_id, 'pos', 'accepted')
  returning id into v_submission_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.buylist_items (
      submission_id, card_id, card_name, condition,
      quantity_submitted, quantity_approved, offered_unit_price_cents
    )
    values (
      v_submission_id,
      (v_item->>'cardId')::uuid,
      v_item->>'cardName',
      v_item->>'condition',
      (v_item->>'quantity')::integer,
      (v_item->>'quantity')::integer,
      (v_item->>'unitPriceCents')::integer
    );
    v_total := v_total + (v_item->>'quantity')::integer * (v_item->>'unitPriceCents')::integer;
  end loop;

  update public.buylist_submissions set total_offer_cents = v_total where id = v_submission_id;

  perform public._apply_buylist_payout(v_submission_id, p_payout_method);

  return v_submission_id;
end;
$$;

grant execute on function public.create_pos_buy(uuid, jsonb, jsonb, text) to authenticated;

-- POS checkout: a customer spends their store credit balance against an
-- order total. Verifies the balance covers the amount, decrements it, logs
-- an audit row, and records the payment -- all atomically, same reasoning
-- as complete_order rejecting a non-pending order.
create function public.redeem_store_credit(p_order_id uuid, p_customer_id uuid, p_amount_cents integer)
returns uuid
language plpgsql
as $$
declare
  v_store_id uuid;
  v_balance integer;
  v_payment_id uuid;
begin
  select store_credit_balance_cents into v_balance
  from public.buylist_customers where id = p_customer_id for update;

  if v_balance is null then
    raise exception 'Customer not found';
  end if;

  if v_balance < p_amount_cents then
    raise exception 'Insufficient store credit balance (has %, needs %)', v_balance, p_amount_cents;
  end if;

  select store_id into v_store_id from public.buylist_customers where id = p_customer_id;

  update public.buylist_customers
  set store_credit_balance_cents = store_credit_balance_cents - p_amount_cents
  where id = p_customer_id;

  insert into public.store_credit_transactions (store_id, customer_id, amount_cents, reason, order_id)
  values (v_store_id, p_customer_id, -p_amount_cents, 'POS redemption', p_order_id);

  insert into public.payments (order_id, method, amount_cents, status)
  values (p_order_id, 'store_credit', p_amount_cents, 'succeeded')
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

grant execute on function public.redeem_store_credit(uuid, uuid, integer) to authenticated;

-- POS's payments.method check constraint predates store credit -- extend it
-- rather than editing the already-shipped POS migration.
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('card', 'cash', 'store_credit'));

-- The public portal's card search runs through the service-role client
-- (see plan: no anon RLS/grants for buylist, service-role-backed Server
-- Actions instead), so service_role needs its own explicit execute grant on
-- search_cards -- RLS bypass and the base grant are separate checks, the
-- same bug class hit repeatedly earlier in this project.
grant execute on function public.search_cards(text, text, int) to service_role;

-- Realtime: the queue board and chat both need live push, not polling, per
-- CLAUDE.md -- same reasoning as tills in the POS migration.
alter publication supabase_realtime add table public.buylist_submissions;
alter publication supabase_realtime add table public.buylist_messages;
