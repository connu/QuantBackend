# MarketPulse

NSE end-of-day market data ingestion service + personal alert engine.
Pulls official NSE data on a nightly schedule, stores it with point-in-time
integrity in TimescaleDB, evaluates your custom rules ("RELIANCE crosses
200DMA", "Nifty PE > 25"), and emails you when they fire.

Built with **NestJS + TypeScript** as a learning project — see `docs/` for a
numbered series explaining every concept used (modules & DI, config, Prisma +
Timescale, cron, BullMQ queues, data integrity, rule engines, notification
seams), and `USER_GUIDE.md` (final checkpoint) for day-to-day usage.

## Layout

```
apps/api   NestJS service (ingestion, backfill, alerts, notifications)
apps/web   minimal dashboard (checkpoint 8)
docs/      the learning docs, 01 → 08
```

## Quick start

```bash
cp .env.example .env        # then fill in values (see comments inside)
docker-compose up -d        # TimescaleDB + Redis
pnpm install
pnpm dev                    # API on :3000, Swagger at /api/docs
```

## Status

Being built in 8 checkpoints — see git history. Currently: **1/8 (scaffold)**.
