import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { previousDay, todayInIndia } from '../common/trading-days';
import { PrismaService } from '../database/prisma.service';
import { CorporateActionsService } from './corporate-actions.service';
import { SyncCaDto } from './dto/sync-ca.dto';

@ApiTags('corporate-actions')
@Controller('corporate-actions')
export class CorporateActionsController {
  constructor(
    private readonly ca: CorporateActionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('sync')
  @ApiOperation({
    summary: 'Fetch & upsert corporate actions from NSE (default: last 2 years)',
  })
  sync(@Body() dto: SyncCaDto) {
    const to = dto.to ?? todayInIndia();
    const from = dto.from ?? shift2YearsBack(to);
    return this.ca.sync(from, to);
  }

  @Get()
  @ApiOperation({ summary: 'List stored corporate actions' })
  @ApiQuery({ name: 'symbol', required: false })
  list(@Query('symbol') symbol?: string) {
    return this.prisma.corporateAction.findMany({
      where: symbol ? { symbol: symbol.toUpperCase() } : undefined,
      orderBy: { exDate: 'desc' },
      take: 100,
    });
  }

  @Get('factors')
  @ApiOperation({ summary: 'Adjustment factors (multiply pre-ex-date prices)' })
  @ApiQuery({ name: 'symbol', required: true })
  factors(@Query('symbol') symbol: string) {
    return this.prisma.adjustmentFactor.findMany({
      where: { symbol: symbol.toUpperCase() },
      orderBy: { exDate: 'desc' },
    });
  }
}

function shift2YearsBack(iso: string): string {
  return `${Number(iso.slice(0, 4)) - 2}${iso.slice(4)}`;
}
