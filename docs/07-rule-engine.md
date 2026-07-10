# 07 — The Rule Engine: User-Defined Logic Without Inventing a Language

## The core tension

Users must express arbitrary conditions ("RELIANCE crosses its 200DMA",
"Nifty PE > 25") — but every drop of expressiveness you grant costs you a
parser, an evaluator, error messages, and security review. This checkpoint
is a study in buying power cheaply.

## Decision 1: structured JSON, not a DSL

```json
{ "all": [ { "indicator": "close", "op": "crosses_above",
             "rhs": { "indicator": "sma", "params": { "n": 200 } } } ] }
```

A leaf compares an **indicator** to a fixed `value` OR to another indicator
(`rhs`). `all` gives AND. Want OR? Make two rules. That tiny grammar covers
every alert we actually wanted — and a web form can build it with dropdowns,
zod validates it in 40 lines (`condition.schema.ts`), and there is no parser
to have bugs. **Don't invent a language until JSON hurts.**

Validation happens at rule *creation* (AlertsService), not evaluation:
`indicator 'volume' not available for INDEX rules (allowed: close, pe, ...)`
comes back as a 400 while a human is watching — not as a log line at 8 PM.

## Decision 2: indicators are pure functions

`indicators.ts` has no NestJS, no database, no clock: arrays in, number (or
null) out. `indicatorAt(series, {indicator:'sma', params:{n:200}}, i)`.
Null means "not enough history" — and null never triggers. A 40-day-old
listing simply can't fire a 200DMA rule; silence beats false alarms.

All stock indicators read the **adjusted** series (doc 06). Feed raw prices
to a rule engine and every split "triggers" a 50% crash alert.

## Decision 3: state vs transition — the crosses_* ops

"close > 200DMA" is **state**: true today, true tomorrow, true for months —
an emailer's spam machine. "close **crossed above** 200DMA" is a
**transition**: yesterday ≤, today >. Transitions fire once, at the moment
of change, which is what humans actually want to know. That's why the
evaluator computes every indicator at today AND yesterday.

State ops still exist (`gt`, `lt`, ...) for genuine level-watching ("PE > 25
territory"), tamed by two mechanisms:

- `cooldownDays` (per rule): after firing, stay quiet N days.
- The DB unique constraint `(ruleId, triggeredOn)`: firing twice on the same
  day is *physically impossible*, even if two evaluations race. Correctness
  by construction beats correctness by care.

## Decision 4: evaluate on events, cron as backup

```
IngestionService ──emit──▶ INGESTION_COMPLETED ──@OnEvent──▶ evaluateAll()
@Cron 20:30 IST (catch-up) ──────────────────────────────────▲
```

The evaluator runs when the data says it's ready, not at a guessed time.
The catch-up cron covers a failed event path — harmless to run both, since
evaluation is idempotent (see above). One subtlety: the backfill also emits
INGESTION_COMPLETED for 2024 dates, so the listener first checks the event's
date IS the newest ingested day. Judging ancient days would create absurd
"alerts" about things that happened two years ago.

Also note the error boundary: each rule evaluates in its own try/catch. One
rule with a deleted symbol must never silence the other nine.

## Seen live

| Test | Result |
|---|---|
| `close > 1` on RELIANCE (always true) | fired: "close 1279.80 > 1" |
| `pe > 20` on NIFTY 50 | fired: "pe 20.66 > 20" — real P/E from the index feed |
| 200DMA cross (insufficient history yet) | correctly silent (null → no fire) |
| `volume` indicator on an INDEX rule | 400 at creation with the allowed list |
| Immediate re-evaluation | "3 rules: 0 triggered" — dedup held, still 2 events |
