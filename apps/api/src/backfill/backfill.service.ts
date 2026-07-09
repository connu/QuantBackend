import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  daysBetween,
  isWeekend,
  previousDay,
  toDbDate,
  todayInIndia,
} from '../common/trading-days';
import { PrismaService } from '../database/prisma.service';
import { IngestionSource, RunStatus } from '../generated/prisma/enums';

export const BACKFILL_QUEUE = 'backfill';

/**
 * ELI5: Backfilling = filling the pantry with the last 2 years of history so
 * indicators like the 200-day moving average have something to chew on.
 *
 * The design is "many small jobs", not "one giant job":
 *   - one BullMQ job per candidate trading day (~500 of them)
 *   - a crash at day 312 loses nothing — 311 jobs are marked done in Redis,
 *     and day 312 retries by itself
 *   - progress is free: it's just the queue's job counts
 *   - re-running "start" is safe: same job IDs are ignored, and days already
 *     in the ledger skip before downloading (see IngestionService)
 *
 * One giant loop-over-days job would have none of these properties.
 */
@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);

  constructor(
    @InjectQueue(BACKFILL_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /** Enqueue one job per candidate day in [from, to]. Defaults: last 2 years. */
  async start(from?: string, to?: string) {
    const end = to ?? previousDay(todayInIndia()); // today's file may not exist yet
    const start = from ?? shiftYears(end, -2);

    // Don't enqueue days we KNOW are non-trading; unknown holidays still
    // slip through and get politely SKIPPED by the ingestion service.
    const holidays = new Set(
      (await this.prisma.tradingHoliday.findMany()).map((h) =>
        h.date.toISOString().slice(0, 10),
      ),
    );
    const candidates = daysBetween(start, end).filter(
      (d) => !isWeekend(d) && !holidays.has(d),
    );

    // Oldest first, so the dataset builds up chronologically.
    const jobs = await this.queue.addBulk(
      candidates.map((tradeDate) => ({
        name: 'backfill-day',
        data: { tradeDate },
        opts: {
          jobId: `backfill-${tradeDate}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { age: 24 * 3600 },
          removeOnFail: false,
        },
      })),
    );

    this.logger.log(
      `Backfill ${start} → ${end}: ${jobs.length} day-jobs enqueued`,
    );
    return { from: start, to: end, enqueued: jobs.length };
  }

  /** Progress = queue counts (live) + ledger summary (what's landed). */
  async status() {
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );

    const [ingested, failures] = await Promise.all([
      this.prisma.ingestionRun.groupBy({
        by: ['source'],
        where: { status: RunStatus.SUCCESS },
        _count: { _all: true },
        _min: { tradeDate: true },
        _max: { tradeDate: true },
      }),
      this.queue.getFailed(0, 9),
    ]);

    return {
      queue: counts,
      ledger: ingested.map((g) => ({
        source: g.source,
        successfulDays: g._count._all,
        earliest: g._min.tradeDate,
        latest: g._max.tradeDate,
      })),
      recentFailures: failures.map((j) => ({
        jobId: j.id,
        tradeDate: (j.data as { tradeDate?: string }).tradeDate,
        reason: j.failedReason,
      })),
    };
  }

  /** How many equity trading days exist in the DB (handy sanity number). */
  async coverage() {
    const rows = await this.prisma.eodPrice.groupBy({
      by: ['tradeDate'],
      where: { supersededAt: null },
    });
    return { distinctTradingDays: rows.length };
  }
}

/** '2026-07-09' minus N years (clamps Feb 29 → Feb 28 via UTC arithmetic). */
function shiftYears(isoDate: string, years: number): string {
  const d = toDbDate(isoDate);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}
