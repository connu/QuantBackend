import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

/**
 * The rules department: users define conditions here; the evaluator judges
 * them whenever ingestion announces fresh data (or the catch-up cron runs).
 * Indicators read PRICES through MarketDataModule — always adjusted.
 */
@Module({
  imports: [MarketDataModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertEvaluatorService],
  exports: [AlertsService],
})
export class AlertsModule {}
