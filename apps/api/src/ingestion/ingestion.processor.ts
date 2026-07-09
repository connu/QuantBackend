import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { IngestionService } from './ingestion.service';

export const INGESTION_QUEUE = 'ingestion';

/**
 * ELI5: The worker at the end of the conveyor belt.
 *
 * Nothing calls IngestionService directly — not the cron, not the REST
 * endpoint. They all just drop a small note ("ingest 2026-07-09") onto the
 * BullMQ queue in Redis, and THIS class picks notes up one at a time and
 * does the slow, failure-prone work.
 *
 * Why the extra hop?
 *  - If the process crashes mid-job, the job is still in Redis → retried.
 *  - If a download flakes, BullMQ re-runs it with exponential backoff
 *    (and our idempotent service makes re-runs harmless).
 *  - concurrency: 1 → days are processed strictly one at a time, which is
 *    also part of being polite to NSE.
 */
@Processor(INGESTION_QUEUE, { concurrency: 1 })
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(private readonly ingestion: IngestionService) {
    super();
  }

  async process(job: Job<{ tradeDate: string }>) {
    this.logger.log(`Job ${job.id}: ingesting ${job.data.tradeDate}`);
    // Whatever we return is stored on the job — visible when inspecting
    // the queue, handy for debugging.
    return this.ingestion.ingestDay(job.data.tradeDate);
  }
}
