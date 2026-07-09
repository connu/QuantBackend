import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BackfillService } from './backfill.service';
import { StartBackfillDto } from './dto/start-backfill.dto';

@ApiTags('backfill')
@Controller('backfill')
export class BackfillController {
  constructor(private readonly backfill: BackfillService) {}

  @Post('start')
  @ApiOperation({
    summary: 'Enqueue historical backfill (default: last 2 years)',
    description:
      'One queue job per trading day, processed politely (~2s/request → ' +
      'a full 2-year backfill takes ~30–40 min). Fully resumable: calling ' +
      'start again, or restarting the app, continues where it left off.',
  })
  start(@Body() dto: StartBackfillDto) {
    return this.backfill.start(dto.from, dto.to);
  }

  @Get('status')
  @ApiOperation({ summary: 'Queue counts + ledger summary + recent failures' })
  status() {
    return this.backfill.status();
  }

  @Get('coverage')
  @ApiOperation({ summary: 'Distinct trading days currently in the price table' })
  coverage() {
    return this.backfill.coverage();
  }
}
