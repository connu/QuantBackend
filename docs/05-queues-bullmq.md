# 05 — Queues & BullMQ: 500 Jobs Without Tears

## Why a queue at all?

Some work shouldn't happen inside an HTTP request: it's slow, it talks to a
flaky third party, it must survive the process dying. The queue pattern
splits such work into three roles:

- **Producer** — writes a small note describing work ("ingest 2024-08-14")
  and drops it in the queue. Takes microseconds, then goes on with life.
- **Broker (Redis)** — holds the notes. Crucially, *outside our process*:
  the app can crash, redeploy, reboot — the notes remain.
- **Worker/consumer** — picks up notes one at a time and does the actual
  work. Reports success/failure back to the broker.

BullMQ is the standard Node implementation of this pattern on Redis.
`@nestjs/bullmq` wraps it in Nest idioms: `BullModule.forRootAsync` (one
Redis connection config in AppModule), `registerQueue` per queue,
`@InjectQueue` for producers, `@Processor` classes for workers.

## A job's life

```
add() ──▶ waiting ──▶ active ──▶ completed
                        │            (kept 24h for us, then auto-pruned)
                        └─ throws ─▶ failed ──(attempts left?)──▶ delayed ─┐
                                       ▲                                   │
                                       └────────── backoff elapsed ───────┘
```

Our job options, and why (backfill.service.ts):

- `attempts: 3, backoff: exponential 60s` — a job that throws is retried at
  +1 min, +2 min, +4 min. Transient NSE hiccups heal themselves; a genuinely
  broken day ends up in `failed` where GET /backfill/status shows it.
- `jobId: backfill-<date>` — natural idempotency key. Adding a job whose ID
  already exists (waiting, active, or completed-and-still-remembered) is a
  no-op. Clicking "start backfill" five times creates zero duplicate work.
- `removeOnComplete: { age: 24*3600 }` — completed jobs auto-delete after a
  day, or Redis would slowly fill with 500 new corpses per backfill.

## Design decision 1: many small jobs, not one big one

The naive backfill is one job: `for day of 500 days { ingest(day) }`.
Ours is 500 jobs of one day each. What the granular version buys:

- **Crash-safety for free.** Die at day 312 → 311 jobs already marked done
  in Redis; day 312 itself retries. The one-big-loop version restarts from
  zero (or needs hand-rolled checkpointing — which is just... a queue).
- **Progress for free.** `queue.getJobCounts()` IS the progress bar:
  `{waiting: 341, completed: 157, failed: 0}`.
- **Retry the failure, not the batch.** One bad day retries alone.

Rule of thumb: pick the smallest unit of work that's independently
meaningful and independently retryable. Here, that's one trading day.

## Design decision 2: two queues, one politeness budget

Ingestion and backfill do identical work but live on separate queues. A
queue is one line — if 500 backfill jobs stood in front of tonight's 7:15 PM
EOD job, today's data (the data your alerts need) would wait ~40 minutes.
Separate queues = separate workers = the EOD job runs the moment it lands.

But politeness toward NSE must be GLOBAL across all workers. That doesn't
live in queue config — it lives in the one shared `NseHttpService` singleton
(one request in flight, 2s gap). Both workers funnel through it; combined
they still can't exceed the limit. Verified in the logs: downloads tick
every ~2s regardless of who asks. Concurrency knobs (`concurrency: 1` on
each worker) are a second belt on top of those suspenders.

## Design decision 3: resume = jobId dedup + ledger fast-path

"Resumable" needs no resume code, just two idempotency layers:

1. Re-POST /backfill/start → same `backfill-<date>` jobIds → BullMQ ignores
   every day it still remembers finishing.
2. A day that *does* get re-processed (e.g. its completed job aged out)
   hits the `ingestion_runs` ledger check — `skipIfIngested` returns
   "already ingested" in one indexed SELECT, before any download.

Seen live: mid-backfill restart, then re-POST with a wider range — old days
skipped instantly, only the 2 genuinely new days downloaded. Bonus find:
2026-06-26 was a holiday missing from our seed; the pipeline recorded
`SKIPPED — no file on NSE` and moved on. Tolerant by design.

## Peeking under the hood

```bash
docker exec -it marketpulse-redis redis-cli
> KEYS bull:backfill:*        # every job + queue structure
> HGETALL bull:backfill:backfill-2026-07-08   # one job's data/opts/result
> LRANGE bull:backfill:wait 0 5               # the actual waiting line
```

Nothing magic — a queue is just Redis lists/hashes/sorted-sets with
discipline. That's worth internalizing once, then never hand-rolling again.
