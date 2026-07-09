/**
 * ELI5: "Seeding" = planting the starter data a fresh database needs.
 * Run with: pnpm --filter api db:seed   (also runs after `migrate reset`)
 *
 * Here that's NSE trading holidays. They let the scheduler skip days where
 * no bhavcopy will ever exist. The list is BEST-EFFORT by design: if a
 * holiday is missing, ingestion just makes one download attempt that finds
 * no file and records the day as SKIPPED — never wrong data. Refresh source:
 * https://www.nseindia.com/resources/exchange-communication-holidays
 */
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

loadDotenv({ path: path.join(__dirname, '../../../.env') });

// [date, description] — trading holidays (equities segment).
const HOLIDAYS: Array<[string, string]> = [
  // --- 2024 ---
  ['2024-01-22', 'Special Holiday'],
  ['2024-01-26', 'Republic Day'],
  ['2024-03-08', 'Mahashivratri'],
  ['2024-03-25', 'Holi'],
  ['2024-03-29', 'Good Friday'],
  ['2024-04-11', 'Id-Ul-Fitr (Ramadan Eid)'],
  ['2024-04-17', 'Shri Ram Navmi'],
  ['2024-05-01', 'Maharashtra Day'],
  ['2024-05-20', 'General Elections (Mumbai)'],
  ['2024-06-17', 'Bakri Id'],
  ['2024-07-17', 'Moharram'],
  ['2024-08-15', 'Independence Day'],
  ['2024-10-02', 'Mahatma Gandhi Jayanti'],
  ['2024-11-01', 'Diwali Laxmi Pujan (muhurat session only)'],
  ['2024-11-15', 'Gurunanak Jayanti'],
  ['2024-11-20', 'Maharashtra Assembly Elections'],
  ['2024-12-25', 'Christmas'],
  // --- 2025 ---
  ['2025-02-26', 'Mahashivratri'],
  ['2025-03-14', 'Holi'],
  ['2025-03-31', 'Id-Ul-Fitr (Ramadan Eid)'],
  ['2025-04-10', 'Shri Mahavir Jayanti'],
  ['2025-04-14', 'Dr. Baba Saheb Ambedkar Jayanti'],
  ['2025-04-18', 'Good Friday'],
  ['2025-05-01', 'Maharashtra Day'],
  ['2025-08-15', 'Independence Day'],
  ['2025-08-27', 'Shri Ganesh Chaturthi'],
  ['2025-10-02', 'Mahatma Gandhi Jayanti / Dussehra'],
  ['2025-10-21', 'Diwali Laxmi Pujan (muhurat session only)'],
  ['2025-10-22', 'Balipratipada'],
  ['2025-11-05', 'Gurunanak Jayanti'],
  ['2025-12-25', 'Christmas'],
  // --- 2026 (fixed-date holidays; refresh festival dates from NSE) ---
  ['2026-01-26', 'Republic Day'],
  ['2026-04-03', 'Good Friday'],
  ['2026-04-14', 'Dr. Baba Saheb Ambedkar Jayanti'],
  ['2026-05-01', 'Maharashtra Day'],
  ['2026-10-02', 'Mahatma Gandhi Jayanti'],
  ['2026-12-25', 'Christmas'],
];

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  // upsert = insert, or quietly do nothing if already there.
  // This makes the seed safe to run any number of times (idempotent) —
  // the same property every ingestion job in this project will have.
  for (const [date, description] of HOLIDAYS) {
    await prisma.tradingHoliday.upsert({
      where: { date: new Date(date) },
      create: { date: new Date(date), description },
      update: { description },
    });
  }

  console.log(`Seeded ${HOLIDAYS.length} trading holidays.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
