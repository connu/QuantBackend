/**
 * ELI5: Tiny date helpers used everywhere. One rule keeps us sane:
 * a trading day is a CALENDAR DATE ("2026-07-09"), never a timestamp.
 * We pass dates around as 'YYYY-MM-DD' strings, and convert to Date
 * objects (at UTC midnight) only at the database boundary.
 */

/** '2026-07-09' → Date at UTC midnight (how Prisma stores @db.Date). */
export function toDbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Date → '2026-07-09' */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's date in India — NOT on this machine's timezone. */
export function todayInIndia(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
  }).format(new Date()); // en-CA locale happens to format as YYYY-MM-DD
}

export function isWeekend(isoDate: string): boolean {
  // getUTCDay because our dates live at UTC midnight: 0=Sun, 6=Sat.
  const day = toDbDate(isoDate).getUTCDay();
  return day === 0 || day === 6;
}

/** '2026-07-09' → '20260709' (NSE bhavcopy filename format) */
export function toCompact(isoDate: string): string {
  return isoDate.replaceAll('-', '');
}

/** '2026-07-09' → '09072026' (NSE index snapshot filename format) */
export function toDdmmyyyy(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}${m}${y}`;
}

/** Previous calendar day (weekends/holidays NOT skipped — callers check). */
export function previousDay(isoDate: string): string {
  const d = toDbDate(isoDate);
  d.setUTCDate(d.getUTCDate() - 1);
  return toIsoDate(d);
}

/** All calendar days from `from` to `to` inclusive (both 'YYYY-MM-DD'). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = nextDay(d)) out.push(d);
  return out;
}

export function nextDay(isoDate: string): string {
  const d = toDbDate(isoDate);
  d.setUTCDate(d.getUTCDate() + 1);
  return toIsoDate(d);
}
