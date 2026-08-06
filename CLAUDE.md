# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Sort Hero is a SortSwift clone — an all-in-one SaaS platform for trading card game (TCG) shops. It covers the full card shop lifecycle: scan cards in → manage inventory → autoprice → sell (POS + online marketplaces) → ship. This is bootstrapped with two developers, so the codebase is a single Next.js monorepo and every infrastructure choice prioritizes free tiers and low cost.

**Note:** This repository is currently empty (no commits yet). The structure and conventions below define the intended architecture for when the project is scaffolded.

## Tech Stack

- **Framework:** Next.js 14+ (App Router, TypeScript, `src/` directory)
- **UI:** Tailwind CSS + shadcn/ui components
- **Database:** Supabase (Postgres + Auth + Storage + Realtime)
- **ORM/Queries:** Supabase JS client (`@supabase/supabase-js`, `@supabase/ssr`)
- **Payments:** Stripe (subscriptions via `stripe`, POS via `@stripe/terminal-js`)
- **Card Recognition:** Tesseract.js for OCR (phase 1, free), Google Cloud Vision API later
- **Image Storage:** Cloudflare R2 (zero egress fees) or Supabase Storage
- **Background Jobs:** Vercel Cron Jobs + Supabase Edge Functions + pg_cron
- **Email:** Resend
- **Validation:** Zod
- **Image Processing:** Sharp

## Project Structure

```
sort-hero/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (marketing)/        # Public landing, features, pricing pages (SSR)
│   │   ├── (auth)/             # Login, register, forgot password
│   │   ├── (dashboard)/        # Authenticated app (inventory, scanning, POS, etc.)
│   │   │   ├── inventory/
│   │   │   ├── scanning/
│   │   │   ├── pos/
│   │   │   ├── buylist/
│   │   │   ├── autopricing/
│   │   │   ├── orders/
│   │   │   ├── settings/
│   │   │   └── reports/
│   │   ├── (public)/           # Public store pages (buylist portal, kiosk, store map)
│   │   └── api/                # API routes
│   │       ├── webhooks/       # Stripe, marketplace webhooks
│   │       └── jobs/           # Cron job endpoints
│   ├── components/             # Shared React components
│   │   └── ui/                 # shadcn/ui components
│   ├── lib/                    # Shared utilities and business logic
│   │   ├── supabase/           # Client, server client, middleware, queries
│   │   ├── stripe/             # Stripe helpers, webhook handlers
│   │   ├── recognition/        # Card scanning and OCR logic
│   │   ├── pricing/            # Autopricing engine
│   │   ├── sync/                # Marketplace sync logic
│   │   └── utils/              # General helpers
│   ├── hooks/                  # Custom React hooks
│   └── types/                  # TypeScript types and Zod schemas
├── supabase/
│   ├── migrations/             # SQL migration files (version-controlled schema)
│   └── functions/              # Supabase Edge Functions
├── public/                     # Static assets
└── .env.local                  # Local env vars (never committed)
```

## Architecture Decisions

- **Monorepo, single deploy.** Everything is one Next.js app deployed to Vercel. No separate backend — API routes handle server logic.
- **Multi-tenant via `store_id`.** Every data table has a `store_id` column. Supabase Row Level Security (RLS) policies enforce tenant isolation so users only see their own store's data.
- **Supabase Auth.** Email/password and OAuth. No custom auth. Supabase middleware handles session management in Next.js.
- **Server Components by default.** Use React Server Components for data fetching. Client Components only when interactivity is needed (forms, modals, real-time updates, camera access).
- **Server Actions for mutations.** Use Next.js Server Actions for form submissions and data mutations instead of API routes where possible.
- **Supabase Realtime for live features.** POS till sync, kiosk updates, scan progress — use Supabase Realtime channels, not polling.
- **All prices stored in cents as integers.** Never use floats for money. `price_cents INTEGER`, display with `(price / 100).toFixed(2)`.

## Key Modules (Build Order)

1. Auth & Stores — Supabase Auth, store creation, memberships, roles
2. Card Database — Games, sets, cards tables. Seed with Scryfall API (MTG) and PokémonTCG API
3. Card Scanning — Camera capture via WebRTC, OCR via Tesseract.js, match against card DB
4. Inventory — CRUD for inventory items, staging area, search, bulk ops
5. CSV Suite — Import/export/edit CSVs, column mapping, 10+ export templates
6. Autopricing — 22-step pricing pipeline, market data ingestion, drag-and-drop config UI
7. POS — Cart, multi-till, Stripe Terminal, split payments, buy mode, returns
8. Buylist — Customer portal, queue board, chat, condition-based pricing
9. Marketplace Sync — Start with Shopify + TCGplayer, add others over time
10. Orders & Shipping — Unified queue, label generation, tracking sync
11. Mobile PWA — Service worker, manifest.json, mobile-optimized scanner
12. Kiosk — Fullscreen mode, PIN auth, customer-facing inventory browser
13. Reports — Sales dashboard, inventory analytics, top sellers

## Database Conventions

- All tables use `uuid` primary keys via `gen_random_uuid()`
- Timestamps: `created_at timestamptz default now()`, `updated_at timestamptz default now()`
- Money: always `_cents INTEGER` columns, never floats
- Soft deletes where needed: `deleted_at timestamptz`
- Table names: lowercase plural (`stores`, `cards`, `inventory_items`)
- Column names: lowercase snake_case
- All tenant-scoped tables get RLS policies matching on `store_id`
- Schema changes go in `supabase/migrations/` with descriptive filenames

## Code Conventions

- TypeScript strict mode, no `any` types
- Use Zod schemas for all API input validation and form validation
- Colocate components: page-specific components live next to their page, shared ones in `src/components/`
- Name files in kebab-case (`card-scanner.tsx`, `pricing-engine.ts`)
- Name components in PascalCase (`CardScanner`, `PricingEngine`)
- Use named exports, not default exports (except for Next.js pages which require default)
- Error handling: try/catch with user-friendly error messages, log full errors server-side
- Use `cn()` from `lib/utils` for conditional Tailwind classes (shadcn pattern)

## Commands

```
npm run dev                          # Start Next.js dev server
npm run build                        # Production build
npm run lint                         # ESLint

npx supabase start                   # Start local Supabase (Postgres, Auth, Storage, Realtime)
npx supabase stop                    # Stop local Supabase
npx supabase db reset                # Reset local DB and re-run all migrations
npx supabase migration new <name>    # Create a new migration file
npx supabase db push                 # Push migrations to remote Supabase
```

## Environment Variables

Required in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_APP_URL`

## External APIs

- **Scryfall API** (free, no key needed) — MTG card data and images
- **PokémonTCG API** (free, key recommended) — Pokémon card data
- **YGOPRODeck API** (free) — Yu-Gi-Oh! card data
- **Stripe API** — Payments and POS terminal
- **Resend API** — Transactional emails
- **Google Cloud Vision API** (phase 2) — Enhanced card recognition

## Infrastructure Gaps & Recommendations

The initial plan lacked several things a real multi-tenant SaaS needs from day one. These are resolved as follows:

- **CI.** `.github/workflows/ci.yml` runs `lint`, `typecheck`, and `build` on every PR and push to `main`. Use this as the merge gate — don't add features without keeping it green.
- **Environments.** Use a separate Supabase project for staging vs production; rely on Vercel preview deployments per PR against staging.
- **Long-running work.** OCR (Tesseract.js) and marketplace sync can exceed Vercel serverless function time limits. Don't do this work inline in an API route — queue it via a Supabase Edge Function or a job queue (e.g., Upstash QStash), with `src/app/api/jobs/` endpoints only kicking off or polling the work, not doing it synchronously.
- **Image storage: resolved to Cloudflare R2.** Card images are egress-heavy; R2 has zero egress fees. `.env.example` has the `R2_*` vars. Use Supabase Storage only for small, low-traffic private assets if needed.
- **Dependency hygiene.** `.github/dependabot.yml` runs weekly npm + GitHub Actions update checks. Run `npm audit` periodically; two known transitive advisories exist as of scaffolding (a `postcss` version bundled inside Next.js 14.2.x's build tooling, and `ws` pulled in by `@stripe/terminal-js`) — both require a breaking major upgrade to clear and are being tracked via Dependabot rather than force-fixed.
- **Idempotency.** Stripe and marketplace webhooks can be retried/duplicated; cron jobs can overlap. Every webhook handler must dedupe on the provider's event ID before processing (e.g., a `processed_webhook_events` table), not assume single delivery.
- **Rate limiting.** Public surfaces (login, buylist portal, kiosk) have no protection yet — add a Redis-backed limiter (e.g., Upstash) before any of these ship publicly.
- **Observability.** No error tracking or alerting is wired up yet. Add Sentry (or equivalent) before the first real user traffic, especially for payment and auth code paths.
- **Backups.** Use Supabase's point-in-time recovery on a paid tier once real shop data exists; document the restore procedure before launch.

## Security Architecture

Security-relevant decisions to follow when implementing each module — this is a multi-tenant SaaS handling other businesses' payments, inventory, and customer data.

**Tenant isolation is the core boundary.**
- RLS is enabled and deny-by-default on every table — no table ships without explicit policies for each of select/insert/update/delete. `store_id` scoping alone is not enough; write and test policies per operation.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is used only in trusted server-side code (webhook handlers, cron/job endpoints) and must never be referenced anywhere reachable from a client bundle or from a Server Action without an auth/role check happening first.
- In-store roles (owner/manager/cashier) are enforced in RLS policies and server-side middleware, not just hidden in the UI.
- Every new table's RLS policies get an integration test (e.g., pgTAP, or a test hitting Supabase with different JWTs) asserting cross-tenant access fails. Treat this as a CI gate, not optional cleanup.

**Auth.**
- Rate-limit login attempts; consider MFA as an option for store-owner accounts given they control payments.
- Session cookies via Supabase SSR middleware must be httpOnly, secure, SameSite — verify this rather than assume Supabase's defaults are sufficient for the deployment.
- Kiosk PIN auth is a separate, lower-trust session scope from full user auth. It must never grant access beyond the public inventory browse it's built for, and PIN attempts are rate-limited.

**Payments.**
- Card data never touches our server — Stripe Terminal/Elements only, keeping PCI scope at SAQ A. No card numbers in logs, ever.
- The server always recomputes cart totals/prices from the DB at checkout; client-submitted amounts are never trusted directly.
- All webhook handlers (Stripe and marketplace) verify signatures (`stripe.webhooks.constructEvent` / marketplace HMAC) and are idempotent against replay/duplicate delivery.

**API & public surfaces.**
- Every Server Action / API route input is validated with Zod, including authorization-relevant fields — a client can never pass `store_id` and have it trusted; it's always derived from the authenticated session server-side.
- Rate limiting on auth endpoints, the buylist portal, and kiosk to blunt credential stuffing and scraping.
- Uploaded card scan images are validated for type/size, stored in private buckets, and served via short-lived signed URLs — never a public-write bucket.

**Data protection & audit.**
- TLS everywhere (Vercel default) plus HSTS.
- Sensitive mutations (inventory adjustments, price overrides, refunds, permission/role changes) go through an audit log table — shop employee theft/fraud is a realistic threat model for POS systems.
- Any platform-admin "view into a store for support" capability is itself a logged, privileged action, not a quiet service-role query.

**Secrets.**
- Supabase service key, Stripe secret, R2 keys live only in Vercel's encrypted env vars, scoped per environment (dev/staging/prod), never shared across environments, and rotated on any suspected exposure.
- R2/storage credentials are scoped to least privilege (bucket-specific tokens), not account-wide keys.
