import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

/**
 * ELI5: A DTO ("data transfer object") is the declared shape of a request
 * body. The global ValidationPipe checks incoming JSON against these
 * decorators BEFORE our code runs, and Swagger reads the same class to
 * document the endpoint. One class, two jobs.
 */
export class RunIngestionDto {
  @ApiProperty({ example: '2026-07-09', description: 'Trading day to ingest' })
  @IsISO8601({ strict: true })
  date!: string;
}
