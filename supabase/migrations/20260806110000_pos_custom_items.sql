-- Custom cart lines (no matching inventory/card row) and a per-line
-- "do not deduct inventory" toggle for the POS cart.
alter table public.order_items
  alter column card_id drop not null,
  add column deduct_inventory boolean not null default true;

-- complete_order must be replaced (not just re-created) since its body
-- changes -- CREATE OR REPLACE is fine here because the *signature*
-- (p_order_id uuid) is unchanged; only the function body differs.
create or replace function public.complete_order(p_order_id uuid)
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
  where oi.order_id = p_order_id
    and oi.inventory_item_id = ii.id
    and oi.deduct_inventory;

  update public.orders set status = 'completed' where id = p_order_id;
end;
$$;
