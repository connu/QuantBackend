import { z } from 'zod';

/**
 * ELI5: This file is the bouncer at the door of our app.
 *
 * Environment variables arrive as untyped strings from `.env` (or the shell).
 * Before the app is allowed to start, every variable is checked against this
 * schema. Wrong type? Missing value? The app refuses to boot and prints
 * exactly what's wrong — instead of mysteriously crashing at 7 PM when the
 * ingestion cron fires and discovers DATABASE_URL was never set.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // z.coerce.number() = "this arrives as a string like '3000', turn it into
  // a real number (and fail loudly if it isn't numeric)".
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  // Email settings are optional for now (checkpoint 7). Blank SMTP_HOST means
  // "dev mode": alerts get printed to the console instead of emailed.
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  ALERT_EMAIL_FROM: z.string().default('MarketPulse <alerts@marketpulse.local>'),
  ALERT_EMAIL_TO: z.string().optional().default(''),
});

/** The validated, correctly-typed shape of our config. */
export type Env = z.infer<typeof envSchema>;

/**
 * NestJS's ConfigModule calls this once at boot with the raw process.env.
 * Throwing here aborts startup — which is exactly what we want.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
