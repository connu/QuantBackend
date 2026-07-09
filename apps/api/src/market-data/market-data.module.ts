import { Module } from '@nestjs/common';
import { MarketDataController } from './market-data.controller';
import { MarketDataService } from './market-data.service';

/**
 * Read-only views over the price store: adjusted series, as-of series,
 * index ratios, symbol search. The dashboard (checkpoint 8) and the alert
 * engine's indicators (checkpoint 6) both read through here.
 */
@Module({
  controllers: [MarketDataController],
  providers: [MarketDataService],
  exports: [MarketDataService],
})
export class MarketDataModule {}
