# 08 — Notifications & Seams: The Last Mile

## The seam (notification-channel.ts)

Everything in this checkpoint hangs off one small interface:

```ts
export const NOTIFICATION_CHANNEL = Symbol('NOTIFICATION_CHANNEL');

export interface NotificationChannel {
  send(message: OutgoingMessage): Promise<void>;
}
```

Upstream code (alert listener, digest cron) composes a message and hands it
to "the channel". It has no idea whether delivery means SMTP, Telegram,
Slack, or a console.log — and that ignorance is the design. The day you
want Telegram: write `TelegramChannel implements NotificationChannel`,
change one line in `notifications.module.ts`. Upstream: zero changes.

This move has many names — a *seam*, a *port* (hexagonal architecture),
"program to an interface". They all mean: **put an interface exactly where
you expect change, and nowhere else.** An interface with one implementation
forever is ceremony; an interface at a genuine seam is freedom. Delivery
mechanisms are a classic genuine seam.

### Why the Symbol token?

TypeScript interfaces don't exist at runtime — they're erased during
compilation. So Nest's DI can't resolve "whoever implements
NotificationChannel"; it needs a runtime name tag. That's the injection
token:

```ts
providers: [
  EmailChannel,
  { provide: NOTIFICATION_CHANNEL, useExisting: EmailChannel },
]
// consumer:
constructor(@Inject(NOTIFICATION_CHANNEL) private channel: NotificationChannel) {}
```

## Graceful degradation: the console transport

`EmailChannel` checks config at boot: no `SMTP_HOST` → messages print to the
console instead of sending. Two principles hide in that choice:

1. **Development shouldn't need secrets.** You can build and test the whole
   alert→notify flow without a mail account.
2. **Degrade visibly, not silently.** A misconfigured mailer that quietly
   drops messages is the worst failure mode. Printing is loud and obvious.

## The paper trail: delivery_log

Every attempt — SENT, FAILED, or CONSOLE — lands in `delivery_log` with
subject, recipient, error, and a link to the alert event where applicable.
"Did it actually email me?" is a `SELECT` (or GET /notifications/deliveries),
not a feeling. Same philosophy as `ingestion_runs`: **any process that talks
to the outside world keeps a ledger.**

## The daily digest (the daily-life feature)

At 21:00 IST the digest cron composes one email from three queries:
headline indices with P/E (Nifty 50 / Bank / 500), your watchlist's moves
(close vs previous close), and whatever alerts fired today. One evening
email instead of opening three apps.

Note it reads "the most recent ingested day", not "today" — on a holiday
evening you get yesterday's state rather than an error. And it's manually
triggerable (`POST /notifications/digest/send`) because every scheduled
thing should also be runnable on demand — for testing, and for impatience.

## Email specifics worth remembering

- Gmail wants an **App Password** (Google account → Security → 2-Step
  Verification → App passwords), not your real password. Port 587 = STARTTLS
  (the common case); 465 = implicit TLS.
- The message carries `text` AND a simple `html` variant. Plain text is the
  reliable workhorse; the HTML just adds hierarchy.
- Alert emails batch per evaluation (one email listing all fired rules),
  because five separate pings at 19:16 is how users unsubscribe from their
  own tool.
