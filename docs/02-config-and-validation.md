# 02 — Configuration & Validation: Fail at Boot, Not at 7 PM

## The problem

This service's most important work happens when nobody is watching: a cron
fires at 7:15 PM, downloads NSE data, evaluates alert rules, sends email. If
`DATABASE_URL` has a typo, when do you want to find out?

- **Bad:** at 7:15 PM, silently, in a stack trace nobody reads until morning.
- **Good:** the moment you start the app, with a message naming the exact
  variable that's wrong.

"Fail fast" is the whole philosophy of this checkpoint.

## The pieces

### 1. `.env` files — config lives outside the code

Secrets and machine-specific values (DB passwords, SMTP credentials) never go
in source code. They live in a `.env` file that git ignores. `.env.example`
(which IS committed) documents every variable a new machine needs.

ELI5: the code is a recipe published in a cookbook; `.env` is the sticky note
on *your* fridge saying which oven and which brand of butter you use.

### 2. `@nestjs/config` — reading the sticky note

In `app.module.ts`:

```ts
ConfigModule.forRoot({
  isGlobal: true,          // every module may inject ConfigService
  validate: validateEnv,   // the bouncer (below)
  envFilePath: ['../../.env', '.env'],  // repo root first
})
```

`isGlobal: true` matters: config is needed *everywhere*, so making every
feature module re-import ConfigModule would be pure noise. Global modules are
for genuinely universal things only — config, database. Resist making
anything else global; explicit imports are what keep the dependency graph
readable.

### 3. `zod` — the bouncer at the door

`process.env` is a bag of `string | undefined`. Zod turns "hope" into a
contract (`src/config/env.validation.ts`):

```ts
PORT: z.coerce.number().int().positive().default(3000),
DATABASE_URL: z.string().url(),
```

Three things happen in that one line about PORT:

- **coerce**: env vars are always strings; `"3000"` becomes `3000`.
- **validate**: `"banana"` → boot refused, with `PORT` named in the error.
- **default**: unset → `3000`, and the default is *in the schema*, documented
  and typed, not sprinkled as `?? 3000` at twelve call sites.

And one more, invisible but the best of all: `z.infer<typeof envSchema>`
derives the TypeScript type `Env` from the schema. Schema and type can never
drift apart, because one *is generated from* the other.

### Why zod for env, but class-validator for request bodies?

You'll notice two validation libraries in this project. Deliberate:

- **Env config** is one flat object validated once at boot → zod's
  schema-first style with type inference is perfect.
- **HTTP request bodies (DTOs)** flow through Nest's `ValidationPipe`, which
  is built around class-validator decorators on DTO classes — and Swagger
  reads those same classes to document the API. Fighting that integration to
  use zod everywhere costs more than the consistency is worth.

Rule: at each seam, use the tool the framework integrates natively; keep the
seams few.

## Flow at boot

```
pnpm dev
  → Nest builds AppModule
    → ConfigModule.forRoot runs validateEnv(process.env)
       ├─ all good → typed config available app-wide via ConfigService
       └─ problem  → throw → app never starts → error names the variable
```

## Try it yourself

1. `cp .env.example .env`, then `pnpm dev` → boots.
2. Edit `.env`, set `PORT=banana`, `pnpm dev` again → refused, with a
   message pointing at PORT. That refusal is the feature.
