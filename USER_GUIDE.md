# MarketPulse — User Guide

Your personal NSE market-data service and alert engine. It pulls official
end-of-day data every evening, stores 2+ years of history, evaluates your
rules, and emails you what matters — one digest a night, plus instant mails
when a rule fires.

*(How it works inside → the numbered series in `docs/`. This file is only
about USING it.)*

---

## 1. Starting the system

```bash
colima start                 # the Docker runtime (once per reboot)
docker-compose up -d         # TimescaleDB + Redis
pnpm --filter api build && pnpm --filter api start     # API on :3000
pnpm --filter web build && pnpm --filter web start     # dashboard on :3001
```

For development use `pnpm dev` (API with hot reload) and
`pnpm --filter web dev`.

- Dashboard: <http://localhost:3001> · API playground (Swagger): <http://localhost:3000/api/docs>
- The API process must stay running — it hosts the schedulers and queue
  workers. On a laptop that sleeps at 7 PM, no data gets pulled; just run a
  manual ingest next morning (§4).

`.env` at the repo root needs at minimum `DATABASE_URL`, `REDIS_HOST`,
`REDIS_PORT`, `PORT` (see `apps/api/src/config/env.validation.ts` for the
full annotated list — the app refuses to boot if something's malformed).

## 2. What happens automatically (IST, weekdays)

| Time | What |
|---|---|
| 19:00 | Corporate actions sync (last 14 days window) |
| 19:15 | EOD ingestion: bhavcopy (~3,100 stocks) + all indices with P/E |
| after ingestion | All active rules evaluated → alert emails if any fired |
| 20:30 | Catch-up evaluation (safety net; harmless duplicate) |
| 21:00 | Daily digest email |

Weekends and NSE holidays are skipped automatically. An unknown holiday just
records a `SKIPPED` run — nothing breaks.

## 3. Getting real emails

Until SMTP is configured, "emails" print to the API console and are logged
in the delivery log — the system is fully testable without secrets.

For Gmail:

1. Google Account → Security → 2-Step Verification → **App passwords**
2. Create one for "Mail"; put it in `.env`:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=<the 16-char app password>
ALERT_EMAIL_FROM="MarketPulse <you@gmail.com>"
ALERT_EMAIL_TO=you@gmail.com
```

3. Restart the API. Test: `curl -X POST localhost:3000/notifications/digest/send`
4. Verify: `GET /notifications/deliveries` should show `SENT`, not `CONSOLE`.

## 4. Everyday recipes

**Create an alert** — dashboard → *Rules*, or curl:

```bash
# "RELIANCE crosses above its 200-day moving average"
curl -X POST localhost:3000/alerts/rules -H 'Content-Type: application/json' -d '{
  "name": "RELIANCE golden cross", "targetType": "STOCK", "symbol": "RELIANCE",
  "condition": { "all": [ { "indicator": "close", "op": "crosses_above",
                            "rhs": { "indicator": "sma", "params": { "n": 200 } } } ] }
}'

# "Nifty is expensive" (fires at most once a week thanks to cooldownDays)
curl -X POST localhost:3000/alerts/rules -H 'Content-Type: application/json' -d '{
  "name": "Nifty PE above 25", "targetType": "INDEX", "symbol": "NIFTY 50",
  "condition": { "all": [ { "indicator": "pe", "op": "gt", "value": 25 } ] },
  "cooldownDays": 7
}'

# "Unusual volume: 3× the 20-day average"
curl -X POST localhost:3000/alerts/rules -H 'Content-Type: application/json' -d '{
  "name": "TCS volume spike", "targetType": "STOCK", "symbol": "TCS",
  "condition": { "all": [ { "indicator": "volume", "op": "gt",
                            "rhs": { "indicator": "avg_volume", "params": { "n": 20 } } } ] }
}'
```

Stock indicators: `close, sma(n), ema(n), week52_high, week52_low, volume,
avg_volume(n), pct_change(n)`. Index indicators: `close, pe, pb, div_yield,
sma(n), pct_change(n)`. Ops: `gt gte lt lte crosses_above crosses_below`.
Prefer `crosses_*` for "tell me when it happens"; use `gt/lt` + cooldown for
"remind me while it's true".

**Curate the digest watchlist:**

```bash
curl -X POST localhost:3000/watchlist -H 'Content-Type: application/json' -d '{"symbol":"INFY"}'
curl -X DELETE localhost:3000/watchlist/INFY
```

**Backfill after downtime** (was the laptop off for a week?):

```bash
curl -X POST localhost:3000/backfill/start -H 'Content-Type: application/json' \
  -d '{"from":"2026-07-01","to":"2026-07-10"}'      # or {} for the full 2 years
curl localhost:3000/backfill/status                  # watch progress
```

Safe to re-run anything — every job checks the ledger before doing work.

**Query your own data:**

```bash
curl "localhost:3000/market-data/prices/RELIANCE?from=2026-01-01&adjusted=true"
curl "localhost:3000/market-data/indices/NIFTY%2050?from=2026-06-01"   # incl. P/E
curl "localhost:3000/market-data/prices/SAPPHIRE?asOf=2026-07-01T00:00:00Z"  # time travel
```

## 5. When something looks wrong

| Symptom | Check |
|---|---|
| No email arrived | `GET /notifications/deliveries` — CONSOLE means SMTP not configured; FAILED shows the error |
| No data for a day | `GET /ingestion/runs` — SKIPPED+"no file on NSE" = holiday; FAILED = see error column, then re-POST `/ingestion/run` |
| Alert didn't fire | Is the rule `active`? Within `cooldownDays` of its last firing? Enough history for the indicator (SMA-200 needs 200 sessions)? |
| Alert fired twice | It can't — DB unique constraint. Two *emails* would mean two events; check `GET /alerts/events` |
| App won't boot | Read the error — the config validator names the exact bad env var; is Docker up (`docker ps`)? |
| Dashboard empty | Is the API on :3000 running? The browser calls it directly |

Everything the system ever did is in three ledgers: `ingestion_runs`
(data in), `alert_events` (decisions), `delivery_log` (messages out).

## 6. Care & feeding

- **Holiday calendar**: each December, add next year's NSE holidays to
  `apps/api/prisma/seed.ts` and run `pnpm --filter api db:seed`. (Missing
  holidays cost one wasted download attempt each — cosmetic.)
- **Backups**: the DB is the crown jewel —
  `docker exec marketpulse-db pg_dump -U marketpulse marketpulse | gzip > backup.sql.gz`
- **Disk**: 2 years ≈ 242 MB. Decades fit on a laptop.
- **NSE changed something?** All scraping lives in `nse-client/` (one URL
  per source file). The CA endpoint already changed once and was a one-line
  fix — see docs/06 for the story.
