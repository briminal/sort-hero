-- Scanning: bulk intake + high-value flagging support.
--
-- A single scalar per-store setting -- unlike the Kiosk PIN, this isn't
-- sensitive, so it lives directly on `stores` rather than a separate
-- settings table with its own grant/RLS split.
alter table public.stores
  add column high_value_threshold_cents integer not null default 2000;
