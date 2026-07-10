import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateRuleDto {
  @ApiProperty({ example: 'RELIANCE golden cross' })
  @IsString()
  name!: string;

  @ApiProperty({ enum: ['STOCK', 'INDEX'], example: 'STOCK' })
  @IsIn(['STOCK', 'INDEX'])
  targetType!: 'STOCK' | 'INDEX';

  @ApiProperty({
    example: 'RELIANCE',
    description: 'Stock symbol, or index name like "NIFTY 50"',
  })
  @IsString()
  symbol!: string;

  @ApiProperty({
    description:
      'See docs/07-rule-engine.md. Example: close crosses above 200DMA',
    example: {
      all: [
        {
          indicator: 'close',
          op: 'crosses_above',
          rhs: { indicator: 'sma', params: { n: 200 } },
        },
      ],
    },
  })
  // Outer shape only — the real validation is the zod condition schema in
  // AlertsService (class-validator can't reach inside arbitrary JSON).
  @IsObject()
  condition!: Record<string, unknown>;

  @ApiPropertyOptional({ example: 7, description: 'Quiet days after firing' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  cooldownDays?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** All fields optional — PATCH semantics for free. */
export class UpdateRuleDto extends PartialType(CreateRuleDto) {}
