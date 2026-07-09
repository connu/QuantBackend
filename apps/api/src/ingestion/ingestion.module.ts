import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NseClientModule } from '../nse-client/nse-client.module';
import { IngestionController } from './ingestion.controller';
import { INGESTION_QUEUE, IngestionProcessor } from './ingestion.processor';
import { IngestionScheduler } from './ingestion.scheduler';
import { IngestionService } from './ingestion.service';

/**
 * The ingestion department. Everything about "getting EOD data in" lives
 * here: the alarm clock (scheduler), the conveyor belt (queue), the worker
 * (processor), the brain (service), and the manual override (controller).
 */
@Module({
  imports: [
    // Registers OUR queue by name. The Redis connection itself is
    // configured once, globally, in AppModule.
    BullModule.registerQueue({ name: INGESTION_QUEUE }),
    NseClientModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService, IngestionProcessor, IngestionScheduler],
  exports: [IngestionService, IngestionScheduler],
})
export class IngestionModule {}
