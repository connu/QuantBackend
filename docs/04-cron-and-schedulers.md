# 04 — Cron & Schedulers: Work That Happens While You Sleep

## The pattern to internalize

This checkpoint's real lesson is one sentence:

> **The scheduler decides WHEN. The queue decides WHETHER-AND-RETRY. The
> worker does the WORK. The service makes re-doing work HARMLESS.**

```
@Cron 19:15 IST ──┐
                  ├──▶ BullMQ queue (Redis) ──▶ Processor ──▶ IngestionService
POST /ingestion/run┘        │                      │               │
                            │                      │               ├─ weekend/holiday? skip
                     job survives crashes,   one job at a time     ├─ download via NseHttpService
                     retries w/ backoff      (concurrency: 1)      ├─ same file hash? skip
                                                                   └─ transaction: supersede + insert
```

Four small classes, each with one job (`src/ingestion/`):
`ingestion.scheduler.ts`, `ingestion.processor.ts`, `ingestion.service.ts`,
plus the shared `nse-client/nse-http.service.ts`.

## @nestjs/schedule in 60 seconds

`ScheduleModule.forRoot()` (in AppModule) scans the app for `@Cron`
decorators and arms each one. Ours:

```ts
@Cron('15 19 * * 1-5', { name: 'eod-ingestion', timeZone: 'Asia/Kolkata' })
```

- The five fields are minute, hour, day-of-month, month, day-of-week —
  "19:15 every weekday". (A leading sixth field would add seconds.)
- `timeZone: 'Asia/Kolkata'` is load-bearing. Without it the cron fires at
  19:15 *machine time* — your laptop, a server in Frankfurt, whatever. With
  it, market close means market close. **Never schedule market events in
  machine time.**
- All date logic obeys the same rule (`common/trading-days.ts`): trading
  days are calendar-date strings; `todayInIndia()` asks the clock what day
  it is *in India*, not here.

## Why the cron handler doesn't just... do the work

The `@Cron` method is four lines: compute today's date, drop a job on the
queue, log, return. Deliberate:

1. **A cron tick is a moment, not a memory.** If the app is down at 19:15
   (deploy, crash, laptop lid closed), the tick simply never happens.
   But a queued job *persists in Redis* — anything enqueued survives
   restarts and gets processed when the app returns.
2. **Retries live in the queue.** NSE flaking at 19:15 doesn't mean no data
   today; the job retries at 19:16, 19:18, 19:22... (exponential backoff,
   5 attempts) with zero extra code in the scheduler.
3. **Manual trigger = same path.** `POST /ingestion/run` enqueues the exact
   same job the cron does. One code path to trust, not two. (That endpoint
   is how we backfill a missed day by hand, too.)

## Idempotency: the property that makes retries safe

Retrying is only a virtue if running twice can't hurt. Layers, outermost in:

1. **Job ID** — jobs are keyed `ingest-<date>`; BullMQ silently drops a
   duplicate add while that ID exists. Cron + impatient human = one job.
2. **File hash** — the ledger (`ingestion_runs`) stores the SHA-256 of every
   file successfully ingested. Re-download the same bytes → record a SKIPPED
   run and stop. (Verified live: re-running 2026-07-09 wrote zero rows.)
3. **Revisions, not overwrites** — if NSE *re-publishes* a day with different
   bytes (it happens), old rows get `superseded_at` stamped and the new file
   lands as `revision + 1`, atomically, in one transaction. Both truths kept.

Layer 1 is convenience; layers 2–3 are the real guarantees. Design rule:
**make the operation safe to repeat, then retry it freely** — the opposite
order (careful never-retry code) is where 2 AM incidents come from.

## Being a polite scraper (nse-http.service.ts)

NSE blocks script-looking clients and hammering IPs. All NSE traffic goes
through one singleton service that: sends browser-like headers, keeps at most
one request in flight with a 2s gap (a promise-chain queue — no library
needed), retries transient errors with backoff, and treats 404 as the
non-error "file doesn't exist" (unlisted holiday / not published yet) so
callers mark the day SKIPPED instead of retrying a fact.

## Seen live (2026-07-09)

| Action | Result |
|---|---|
| First run | 3,129 equity rows + 160 index rows (136 with P/E) in ~2s |
| Re-run, same day | queue dropped the duplicate job ID |
| Re-run after clearing job | two SKIPPED runs: "file identical to previous successful run" |
| Sunday requested | "2026-07-05: weekend — skipping", no NSE traffic at all |
