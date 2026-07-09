import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class SyncCaDto {
  @ApiPropertyOptional({ example: '2024-07-10' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-07-10' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
