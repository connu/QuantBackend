import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { todayInIndia } from '../common/trading-days';
import { INGESTION_QUEUE } from './ingestion.processor';

/**
 * ELI5: The alarm clock. It does NOTHING except enqueue a job when it rings
 * — the actual work lives in the processor. Keeping the cron handler this
 * dumb means a slow/failed ingestion can never wedge the scheduler itself.
 *
 * Cron expression crash course:  "15 19 * * 1-5"
 *                                 │  │  │ │  └ day of week (1-5 = Mon-Fri)
 *                                 │  │  │ └── month (any)
 *                                 │  │  └──── day of month (any)
 *                                 │  └─────── hour (19 = 7 PM)
 *                                 └────────── minute (15)
 * = every weekday at 19:15 — and crucially, 19:15 IN INDIA (timeZone
 * option), regardless of what timezone this machine sits in. NSE usually
 * publishes the bhavcopy between 6 and 7 PM IST, so 7:15 PM is safely after.
 */
@Injectable()
export class IngestionScheduler {
  private readonly logger = new Logger(IngestionScheduler.name);

  constructor(
    @InjectQueue(INGESTION_QUEUE) private readonly queue: Queue,
  ) {}

  @Cron('15 19 * * 1-5', { name: 'eod-ingestion', timeZone: 'Asia/Kolkata' })
  async enqueueTodaysIngestion() {
    const tradeDate = todayInIndia();
    await this.enqueue(tradeDate);
    this.logger.log(`Enqueued EOD ingestion for ${tradeDate}`);
  }

  /** Shared by the cron above and the manual REST trigger. */
  async enqueue(tradeDate: string) {
    return this.queue.add(
      'ingest-day',
      { tradeDate },
      {
        // Same jobId = BullMQ ignores duplicates. If the cron fires AND a
        // human clicks "run" for the same day, only one job exists.
        jobId: `ingest-${tradeDate}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 7 * 24 * 3600 }, // keep a week of history
        removeOnFail: false,
      },
    );
  }
}
