-- Inventory CRUD fields on top of the inventory_items table created by
-- Card Scanning. No RLS/grant changes needed -- existing table-level grants
-- and policies already cover new columns.

alter table public.inventory_items
  add column condition text not null default 'NM' check (condition in ('NM', 'LP', 'MP', 'HP', 'DMG')),
  add column price_cents integer,
  add column notes text;
