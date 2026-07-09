import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class StartBackfillDto {
  @ApiPropertyOptional({
    example: '2024-07-10',
    description: 'First day to backfill (default: 2 years before `to`)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-07-09',
    description: 'Last day to backfill (default: yesterday in India)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
