# 06 — Data Integrity: Corporate Actions & Point-in-Time Truth

Two separate integrity problems live in this checkpoint. Both share one
principle: **raw data is sacred; everything else is derived at read time.**

## Problem 1: prices lie across corporate actions

Pull up SAPPHIRE around 2024-09-05 (real output from our API):

```
raw close                     adjusted close
2024-09-04   1683.70          336.74
2024-09-05    332.05          332.05    ← 10→2 face-value split ex-date
```

Nobody lost 80% overnight — each ₹10 share became five ₹2 shares. But every
naive computation (200DMA, % change, chart) sees a crash. An alert engine
built on raw prices would fire garbage on every split and bonus.

### The fix: adjustment factors, applied on read

- `corporate-actions/` ingests NSE's announcements feed (4,628 actions over
  our 2 years) and keeps NSE's raw `purpose` string forever.
- A parser (`parsers/ca.parser.ts`, pure function) extracts structure:
  - `"...Split... From Rs 10 To Rs 2"` → 1 share becomes 5
  - `"Bonus 1:1"` → 1 share becomes 2
  - Unparseable → `OTHER` with null ratios. **Never guess**: a wrong factor
    silently corrupts every adjusted price; a missing one is visible.
- Each split/bonus yields a row in `adjustment_factors`:
  `factor = ratioOld / ratioNew` (0.2 for that split, 0.5 for a 1:1 bonus).
- At read time (`market-data.service.ts`), walking the series newest→oldest:
  cross an ex-date, multiply its factor into a running product; every older
  price gets multiplied. O(n), no mutation, nothing stored.

Why not store adjusted prices? Because a NEW split changes every historical
adjusted price for that symbol — you'd rewrite millions of rows (and lose
the original quotes forever). The factor table is ~200 rows and a new action
is one INSERT. Derived data is cheap; raw data is irreplaceable.

(Dividends don't adjust prices in split/bonus-adjusted series — standard
convention. We parse and store them anyway; useful for digests later.)

### Parsing free text defensively

NSE's `purpose` is human-written text. Results over 2 years: 112/112 splits
parsed, 109/110 bonuses (one had no machine-readable ratio), 3,255/3,257
dividends. The failures became `OTHER`/null — visible in a simple SQL query,
correctable by hand if ever needed. That's the defensive-parsing contract:
**parse what you can prove, surface what you can't.**

Also: NSE renamed this API endpoint at some point (the old
`corporates-corporate-actions` path now 404s). The fix was reading the CA
page's JS bundle to find the new name — scrapers rot, and the module
boundary (one URL, one service) is what made it a one-line fix.

## Problem 2: "what did we know on March 3rd?"

Exchanges occasionally re-publish a day's file with corrections. If we
UPDATEd rows in place, yesterday's backtest and today's audit would silently
disagree — and you could never prove why.

### The fix: revisions, not overwrites

Rows in `eod_prices` are never updated with new values. Re-ingesting a
changed file, in one transaction:

1. current rows for that day get `superseded_at = now()` stamped;
2. the new file's rows insert with `revision + 1`;
3. both link to their `ingestion_runs` row (when, which file, what hash).

Two queries fall out (see `market-data.service.ts`):

- **Current belief** (the 99% case): `WHERE superseded_at IS NULL`.
- **Belief at time T**: row's ingestion run finished ≤ T, AND
  `superseded_at IS NULL OR superseded_at > T`. A row is "visible at T"
  if it had been born and not yet replaced.

Verified live: the same request with `asOf=<yesterday>` returns `[]`
(we hadn't backfilled September 2024 yet), with `asOf=<now>` returns 5 rows.
No snapshot copies exist anywhere — a snapshot is a *WHERE clause*, which is
why the feature costs two columns, not gigabytes.

This pattern has many names — temporal tables, bitemporal modeling (finance),
type-2 slowly-changing dimensions (warehousing). Same idea everywhere:
**append + mark, never destroy; reconstruct any past belief with a filter.**

## The session dance (nse-http.service.ts addendum)

Unlike the archives host, `www.nseindia.com/api/*` requires session cookies:
visit the homepage like a browser, collect cookies, send them back, refresh
every ~5 min, and drop them on 401/403 so the retry warms a fresh session.
All hidden inside the same singleton — callers just say
`download(url, { withSession: true })`.
