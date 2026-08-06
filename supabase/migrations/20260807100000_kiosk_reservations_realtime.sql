-- POS's "Reserved" cart tab needs pending kiosk reservations to appear live
-- for staff without polling, same as till status -- CLAUDE.md requires
-- Realtime for POS/kiosk live features.
alter publication supabase_realtime add table public.kiosk_reservations;
