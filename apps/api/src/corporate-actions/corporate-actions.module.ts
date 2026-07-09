import { Module } from '@nestjs/common';
import { NseClientModule } from '../nse-client/nse-client.module';
import { CorporateActionsController } from './corporate-actions.controller';
import { CorporateActionsService } from './corporate-actions.service';

/**
 * Owns everything about splits/bonuses/dividends: fetching announcements,
 * parsing NSE's free-text purposes, and deriving the adjustment factors
 * that MarketDataModule applies at read time.
 */
@Module({
  imports: [NseClientModule],
  controllers: [CorporateActionsController],
  providers: [CorporateActionsService],
  exports: [CorporateActionsService],
})
export class CorporateActionsModule {}
