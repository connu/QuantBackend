import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { previousDay, todayInIndia } from '../common/trading-days';
import { MarketDataService } from './market-data.service';

@ApiTags('market-data')
@Controller('market-data')
export class MarketDataController {
  constructor(private readonly marketData: MarketDataService) {}

  @Get('prices/:symbol')
  @ApiOperation({
    summary: 'OHLCV series for a stock',
    description:
      'adjusted=true (default) multiplies out splits/bonuses so history is ' +
      'comparable. asOf=<ISO timestamp> answers "what did we believe then?"',
  })
  @ApiQuery({ name: 'from', required: false, example: '2025-07-10' })
  @ApiQuery({ name: 'to', required: false, example: '2026-07-10' })
  @ApiQuery({ name: 'adjusted', required: false, example: 'true' })
  @ApiQuery({ name: 'asOf', required: false, description: 'ISO timestamp' })
  prices(
    @Param('symbol') symbol: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('adjusted') adjusted?: string,
    @Query('asOf') asOf?: string,
  ) {
    const end = to ?? todayInIndia();
    return this.marketData.priceSeries({
      symbol,
      from: from ?? `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`,
      to: end,
      adjusted: adjusted !== 'false',
      asOf,
    });
  }

  @Get('indices/:name')
  @ApiOperation({ summary: 'Index series with P/E, P/B, dividend yield' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  indices(
    @Param('name') name: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const end = to ?? todayInIndia();
    return this.marketData.indexSeries(
      name,
      from ?? `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`,
      end,
    );
  }

  @Get('symbols')
  @ApiOperation({ summary: 'Search the instrument catalog' })
  @ApiQuery({ name: 'q', required: true, example: 'RELI' })
  symbols(@Query('q') q: string) {
    return this.marketData.searchSymbols(q ?? '');
  }
}
