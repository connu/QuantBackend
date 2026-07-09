import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module';
import { BackfillController } from './backfill.controller';
import { BackfillProcessor } from './backfill.processor';
import { BACKFILL_QUEUE, BackfillService } from './backfill.service';

/**
 * The history department: floods the price table with the past 2 years,
 * politely, resumably. Reuses IngestionService (imported from
 * IngestionModule) — backfilling IS ingestion, just for old dates.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: BACKFILL_QUEUE }),
    IngestionModule,
  ],
  controllers: [BackfillController],
  providers: [BackfillService, BackfillProcessor],
})
export class BackfillModule {}
