# 01 — NestJS: The Big Picture

## Why does NestJS exist?

Express (the classic Node web library) gives you a single tool: "when a URL is
hit, run this function." That's plenty for 3 routes. At 30 routes, with a
database, queues, scheduled jobs, and email — every Express project invents its
own folder structure, its own way to share a DB connection, its own way to
test things. Every project becomes a snowflake.

NestJS is an opinionated framework on top: it decides *where things go* and
*how parts find each other*, so you spend your thinking on the actual problem
(market data, alerts) instead of on plumbing. If you've seen Spring (Java) or
Angular, Nest will feel familiar — same lineage of ideas.

## The three building blocks

Think of the app as a company:

| Concept | Role in the company | In our code |
|---|---|---|
| **Controller** | Front desk. Takes requests from outside, hands them to the right person, returns the answer. Does no real work itself. | `app.controller.ts` answers `GET /health` |
| **Provider / Service** | The employees. All actual work: downloading bhavcopies, evaluating alert rules, sending email. | coming in later checkpoints |
| **Module** | A department. A labelled box grouping related controllers + services, declaring what it needs from other departments. | `app.module.ts` is the root department |

## Dependency Injection (DI) — the one idea that makes Nest, Nest

Normally, if class A needs class B, A writes `new B()` somewhere. This couples
them: A must know how to build B, and B's dependencies, and so on. Testing A
alone becomes painful.

In Nest, A never builds anything. A just *declares* what it needs, in its
constructor:

```ts
@Injectable()
class AlertEvaluator {
  // "I need these two. Someone hand them to me."
  constructor(
    private readonly prices: PriceService,
    private readonly notifier: NotificationService,
  ) {}
}
```

At boot, Nest reads the whole module tree, figures out the order to construct
everything, builds ONE instance of each provider (a singleton, by default),
and injects it wherever it's declared. Hence "dependency **injection**".

ELI5: it's a restaurant kitchen. The chef (your service) doesn't grow
vegetables or forge knives. She writes a list of what she needs; the kitchen
manager (Nest's DI container) makes sure it's all at her station before
service starts.

Why it's worth it:

1. **Swappability.** In checkpoint 7, `NotificationService` is an interface
   seam — swapping email for Telegram means registering a different class.
   Nobody who *uses* notifications changes at all.
2. **Testability.** In a test, hand `AlertEvaluator` a fake `PriceService`
   with canned prices. No database needed.
3. **One of everything.** DB connection pools, HTTP clients with warm session
   cookies (our NSE client!) — you want exactly one, shared. Singletons by
   default gives you that for free.

## The decorators (`@Something`)

Those `@Module(...)`, `@Injectable()`, `@Get()` annotations are TypeScript
decorators — metadata stapled onto classes and methods. Nest scans this
metadata at boot to build its wiring plan. That's why `tsconfig.json` has
`experimentalDecorators` and `emitDecoratorMetadata` turned on: without them,
the metadata (like constructor parameter types) never reaches the compiled
JavaScript, and Nest would be wiring blind.

## The request lifecycle in this project

```
HTTP request
   │
   ▼
Global ValidationPipe (main.ts) — is the body shaped like the DTO says?
   │
   ▼
Controller method (@Get/@Post ...) — parses "who wants what"
   │
   ▼
Service(s) — the real work (DB queries, calculations)
   │
   ▼
Return value → serialized to JSON → response
```

Pipes are one of several interception points Nest offers (there are also
guards for auth, interceptors for logging/caching, exception filters for
error shaping). We use the ValidationPipe globally from day one; the others
will appear when a real need shows up — not before.

## Where things live in this repo

```
apps/api/src/
  main.ts            ← ignition: build app, bolt on pipes/Swagger, listen
  app.module.ts      ← root module: imports every feature module
  app.controller.ts  ← /health endpoint
  config/            ← env validation (see doc 02)
  <feature>/         ← one folder per feature module, added per checkpoint:
    feature.module.ts, feature.controller.ts, feature.service.ts
```

Rule of thumb used throughout: **controllers stay skinny** (parse, delegate,
return), **services hold the logic**, and **each module owns its own tables**
conceptually — other modules go through its service, not its tables.




# 1. Infrastructure (once per reboot)
colima start                  # the Docker runtime
docker-compose up -d          # TimescaleDB + Redis containers

# 2. The API (terminal 1) — must stay running: it hosts the crons & workers
pnpm dev                      # → http://localhost:3000  (Swagger at /api/docs)

# 3. The dashboard (terminal 2)
pnpm --filter web dev         # → http://localhost:3001

That's it. The database and its 2 years of data persist in Docker volumes, so steps 1–3 pick up exactly where you left off.

Two variants worth knowing:

- Production-ish (slightly faster, no file watching): pnpm --filter api build && pnpm --filter api start, and pnpm --filter web build && pnpm --filter web start.
- After the laptop was off during market hours: data for missed days didn't pull itself — run a quick catch-up once the API is up:
curl -X POST localhost:3000/backfill/start -H 'Content-Type: application/json' -d '{"from":"<first-missed-day>"}'

Full details (email setup, alert recipes, troubleshooting) are in USER_GUIDE.md.