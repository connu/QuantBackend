import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { IngestionService } from '../ingestion/ingestion.service';
import { BACKFILL_QUEUE } from './backfill.service';

/**
 * ELI5: Same worker idea as the nightly ingestion, but on its OWN queue.
 *
 * Why two queues when the work is identical? Priority isolation. A queue
 * is a single line: if 500 backfill jobs shared the line with tonight's
 * 7:15 PM EOD job, today's fresh data (which your alerts need!) would wait
 * behind two years of history. Separate lines → the EOD worker is always
 * free the moment its job arrives.
 *
 * Both workers still share the singleton NseHttpService, so combined they
 * can never exceed the polite one-request-per-2s limit toward NSE.
 */
@Processor(BACKFILL_QUEUE, { concurrency: 1 })
export class BackfillProcessor extends WorkerHost {
  constructor(private readonly ingestion: IngestionService) {
    super();
  }

  async process(job: Job<{ tradeDate: string }>) {
    // skipIfIngested: a re-started backfill flies through finished days.
    return this.ingestion.ingestDay(job.data.tradeDate, {
      skipIfIngested: true,
    });
  }
}
