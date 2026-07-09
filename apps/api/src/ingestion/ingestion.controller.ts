import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiQuery } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { RunIngestionDto } from './dto/run-ingestion.dto';
import { IngestionScheduler } from './ingestion.scheduler';

@ApiTags('ingestion')
@Controller('ingestion')
export class IngestionController {
  constructor(
    private readonly scheduler: IngestionScheduler,
    private readonly prisma: PrismaService,
  ) {}

  @Post('run')
  @ApiOperation({
    summary: 'Manually enqueue ingestion for one day',
    description:
      'Same path the 7:15 PM cron takes — drops a job on the queue and ' +
      'returns immediately. Watch progress via GET /ingestion/runs. ' +
      'Safe to call repeatedly: identical files are recognized and skipped.',
  })
  async run(@Body() dto: RunIngestionDto) {
    const job = await this.scheduler.enqueue(dto.date);
    return { enqueued: true, jobId: job.id };
  }

  @Get('runs')
  @ApiOperation({ summary: 'Recent ingestion runs (the audit ledger)' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  async runs(@Query('limit') limit?: string) {
    return this.prisma.ingestionRun.findMany({
      orderBy: { id: 'desc' },
      take: Math.min(Number(limit) || 20, 200),
    });
  }
}
