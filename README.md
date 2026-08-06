# Sort Hero

All-in-one SaaS platform for trading card game (TCG) shops. See [CLAUDE.md](./CLAUDE.md) for full architecture, conventions, and security/infrastructure notes.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Start local Supabase (Postgres, Auth, Storage, Realtime):
   ```
   npx supabase start
   ```
   This project's `supabase/config.toml` uses non-default ports (API on
   `55321`, DB on `55322`, Studio on `55323`, etc. -- everything shifted
   +1000 from the Supabase CLI defaults) so it can run alongside another
   local Supabase project on the same machine without a port collision.
3. Copy the env template and fill in values from the output of step 2 (or
   run `npx supabase status` to see them again):
   ```
   cp .env.example .env.local
   ```
   `NEXT_PUBLIC_SUPABASE_URL` should be `http://127.0.0.1:55321`, and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` come from
   that same output. If you're also running another local Supabase project,
   double-check you're copying keys from *this* project's `supabase status`
   output, not the other one's -- they won't work against each other's DB.
4. Run the dev server:
   ```
   npm run dev
   ```

## Common commands

```
npm run dev          # Start Next.js dev server
npm run build         # Production build
npm run lint          # ESLint
npm run typecheck     # TypeScript, no emit

npx supabase start    # Start local Supabase
npx supabase stop     # Stop local Supabase
npx supabase db reset # Reset local DB and re-run all migrations
npx supabase migration new <name>  # Create a new migration file
npx supabase db push  # Push migrations to remote Supabase
```
