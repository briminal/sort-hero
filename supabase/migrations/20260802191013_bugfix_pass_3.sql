-- Bug-hunt pass #3 (post-Buylist module review): fixes a real oversell race
-- found in complete_order. createOrder only checks stock via a plain
-- (non-locked) select at cart-checkout time; the actual decrement happens
-- later, inside complete_order, triggered by a separate payment action.
-- Two POS terminals selling the last copies of a card concurrently could
-- both pass the checkout-time check and later both complete, driving
-- inventory_items.quantity negative with no error. This adds a
-- FOR UPDATE lock per row plus an explicit insufficient-stock guard, so the
-- losing concurrent order fails loudly at completion instead of silently
-- corrupting inventory.
create or replace function public.complete_order(p_order_id uuid)
returns void
language plpgsql
as $$
declare
  v_status text;
  v_item record;
  v_available integer;
begin
  select status into v_status from public.orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'Order not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Order is not pending (status: %)', v_status;
  end if;

  -- Ordered by inventory_item_id so two orders locking the same rows always
  -- acquire their FOR UPDATE locks in the same sequence -- without this, two
  -- concurrent completions that share inventory rows but added them to their
  -- carts in different sequences could lock-order-deadlock against each
  -- other (Postgres would abort one, but there's no reason to risk it).
  for v_item in
    select oi.inventory_item_id, oi.quantity, oi.card_name
    from public.order_items oi
    where oi.order_id = p_order_id and oi.inventory_item_id is not null
    order by oi.inventory_item_id
  loop
    select quantity into v_available from public.inventory_items where id = v_item.inventory_item_id for update;

    if v_available is null or v_available < v_item.quantity then
      raise exception 'Not enough stock for % (have %, need %)', v_item.card_name, coalesce(v_available, 0), v_item.quantity;
    end if;

    update public.inventory_items set quantity = quantity - v_item.quantity where id = v_item.inventory_item_id;
  end loop;

  update public.orders set status = 'completed' where id = p_order_id;
end;
$$;
