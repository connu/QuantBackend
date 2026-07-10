# MarketPulse

Personal NSE market-data platform + alert engine. Every weekday evening it
pulls official end-of-day data (all ~3,100 stocks, all indices with P/E),
stores it with point-in-time integrity in TimescaleDB, evaluates your custom
rules ("RELIANCE crosses 200DMA", "Nifty PE > 25"), and emails you — instant
alerts plus a nightly digest of indices, your watchlist, and firings.

Built with **NestJS + TypeScript** as a learning project: `docs/01…08` is a
reading course through every concept used, and the code carries ELI5
comments at each idea's first appearance.

## Using it

**→ [USER_GUIDE.md](USER_GUIDE.md)** — setup, alert recipes, troubleshooting.

```bash
colima start && docker-compose up -d      # TimescaleDB + Redis
pnpm install
pnpm --filter api db:generate && pnpm --filter api db:migrate && pnpm --filter api db:seed
pnpm dev                                  # API :3000 (Swagger at /api/docs)
pnpm --filter web dev                     # dashboard :3001
```

`.env` at repo root: see the annotated schema in
`apps/api/src/config/env.validation.ts` (DATABASE_URL, REDIS_*, optional SMTP_*).

## Layout

```
apps/api                 NestJS service
  src/nse-client/        polite HTTP client (rate limit, retries, cookies)
  src/ingestion/         cron → queue → idempotent EOD ingest
  src/backfill/          resumable 2-year historical backfill
  src/corporate-actions/ splits/bonuses → price adjustment factors
  src/market-data/       read API: adjusted & as-of price series
  src/alerts/            rule engine (JSON conditions, indicators)
  src/notifications/     channel seam → email; daily digest
apps/web                 minimal Next.js dashboard (rules/alerts/chart/system)
docs/                    the learning course, 01 → 08
```

## The learning course (docs/)

1. NestJS big picture — modules, DI, decorators
2. Config & validation — fail at boot, not at 7 PM
3. Prisma 7 + TimescaleDB — hypertables, migrations, Decimal-not-Float
4. Cron & schedulers — the scheduler/queue/worker split, IST timezones
5. Queues & BullMQ — 500 small jobs, retries, resume-for-free
6. Data integrity — corporate actions, revisions, as-of time travel
7. The rule engine — structured JSON over DSLs, state vs transition
8. Notifications & seams — ports/adapters, graceful degradation, ledgers

## Status

Feature-complete (8/8 checkpoints). The database currently holds 2 years of
history: 492 trading days, 1.37M price rows, 242 MB, zero failed jobs.
