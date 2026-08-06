# Sort Hero

All-in-one SaaS platform for trading card game (TCG) shops. See [CLAUDE.md](./CLAUDE.md) for full architecture, conventions, and security/infrastructure notes.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy the env template and fill in values:
   ```
   cp .env.example .env.local
   ```
3. Start local Supabase (Postgres, Auth, Storage, Realtime):
   ```
   npx supabase start
   ```
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
