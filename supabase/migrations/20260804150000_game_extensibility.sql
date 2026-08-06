-- Buylist plan Phase 1: game extensibility. `games`/`sets`/`cards` were
-- already fully game-agnostic (no game-specific columns, no check
-- constraint on `games.code`) -- the 3-game limit was purely a hardcoded
-- Zod enum + UI dropdown list in application code, replaced separately.
--
-- These rows are placeholders only -- no card/set data ingestion for them
-- yet (no Scryfall-equivalent source wired up per game). Search/scan
-- against these games correctly returns zero results ("no cards available
-- yet") until real seeding is built for a given game, once there's actual
-- demand for it -- not before.
insert into public.games (name, code) values
  ('Flesh and Blood', 'fab'),
  ('One Piece Card Game', 'onepiece'),
  ('Star Wars: Unlimited', 'swu'),
  ('Disney Lorcana', 'lorcana'),
  ('Digimon Card Game', 'digimon'),
  ('Grand Archive', 'grandarchive'),
  ('Union Arena', 'unionarena'),
  ('Dragon Ball Super Fusion World', 'dbsfw')
on conflict (code) do nothing;
