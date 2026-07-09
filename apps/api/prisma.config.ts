// ELI5: config for the Prisma CLI (migrate/generate/seed) — the runtime app
// never reads this file. Prisma 7 stopped auto-loading .env, so we load the
// repo-root .env ourselves first.
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

loadDotenv({ path: path.join(__dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
