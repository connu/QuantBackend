# 03 — Prisma + TimescaleDB: The Storage Layer

## The shape of the problem

We're storing two very different kinds of data:

1. **Time-series** — one price row per stock per day. ~2,000 symbols × ~250
   trading days/year. Grows forever, is written once per day in bulk, and is
   queried almost exclusively by date range ("RELIANCE, last 200 days").
2. **Regular app data** — alert rules, ingestion bookkeeping, delivery logs.
   Small, changes rarely, normal CRUD.

Postgres handles #2 natively. For #1 we add the TimescaleDB extension.

## What a hypertable actually is

A plain table slows down as it grows because every query wades through one
giant heap. `create_hypertable('eod_prices', 'trade_date')` makes Postgres
secretly split the table into **chunks** — one physical sub-table per month
of data. You still query `eod_prices` like a normal table; the planner just
skips every chunk outside your date range without reading it.

ELI5: instead of one enormous filing cabinet you rummage through end to end,
you get one labelled drawer per month — and you only open the drawers your
query mentions.

The one rule it imposes (you'll see it in `schema.prisma`): every
PRIMARY KEY / unique constraint **must include the partition column**
(`trade_date`). Uniqueness can only be enforced inside a drawer, not across
all drawers at once. Our PK is `(symbol, series, trade_date, revision)` —
rule satisfied.

Honesty note: at our volume (~500k rows/year) plain Postgres with a good
index would also be fine. We use Timescale because this project is the data
backbone for later, hungrier projects — and because learning it now is cheap.

## Why Prisma, and how Prisma 7 changed things

Prisma's job: one schema file (`prisma/schema.prisma`) that produces both the
SQL migrations *and* a fully-typed TypeScript client. Misspell a column in
code → compile error, not a runtime surprise.

Prisma 7 reorganized where things live (you'll see all three in this repo):

| Piece | Where it lives now |
|---|---|
| Table definitions | `prisma/schema.prisma` (as always) |
| Connection URL for the CLI | `prisma.config.ts` (no longer in the schema) |
| Connection at runtime | a **driver adapter** — `PrismaPg` wrapping the standard `pg` driver, passed to the client in `src/database/prisma.service.ts` |
| Generated client | real TypeScript in `src/generated/prisma/` (gitignored; rebuild with `pnpm --filter api db:generate`) |

## Migrations: the database's git history

`pnpm --filter api db:migrate` diffs the schema file against the live DB and
writes a dated SQL file into `prisma/migrations/`. Every copy of this project
replays the same scripts in the same order → identical databases everywhere.

Prisma doesn't know what a hypertable is, so our first migration is
**hand-extended**: after Prisma's generated `CREATE TABLE`s, we appended raw
SQL:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('eod_prices', by_range('trade_date', INTERVAL '1 month'));
```

That's the escape hatch pattern worth remembering: let the ORM do the 95% it
understands, and drop to SQL for the 5% it doesn't — *inside the same
migration system*, so it's still versioned and replayable.

## Design decisions worth noticing in the schema

- **Revisions, not overwrites.** Price rows are never UPDATEd with new
  values. A re-published bhavcopy stamps old rows' `superseded_at` and
  inserts `revision + 1` rows. "Current" data is `WHERE superseded_at IS
  NULL`; "the data as we believed it on March 3rd" is reconstructable.
  (Full story in doc 06.)
- **`ingestion_runs` is a ledger, not a log.** Jobs consult it before
  working (has this day already succeeded with this exact file?) — that's
  what makes re-running a job harmless. Doc 04/05 build on this.
- **Money is `Decimal`, never `Float`.** Binary floats can't represent 0.1
  exactly; accumulate a few thousand of them and paise go missing. Postgres
  `NUMERIC` + Prisma's `Decimal` are exact.
- **Dedup as a constraint, not a convention.** "One alert event per rule per
  day" is a `@@unique([ruleId, triggeredOn])` — the database physically
  cannot store a duplicate, no matter what bugs the app code grows.
- **`DateTime @db.Date` for trading days.** A trading day is a calendar
  date, not an instant. We store dates and never do timezone math on them.

## Seeding

`prisma/seed.ts` plants NSE trading holidays (so the scheduler doesn't try to
download bhavcopies on Diwali). It upserts, so running it twice is harmless —
your first meeting with **idempotency**, this project's favorite word.
