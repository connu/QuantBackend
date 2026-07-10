import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { AlertsService } from './alerts.service';
import { CreateRuleDto, UpdateRuleDto } from './dto/create-rule.dto';

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly evaluator: AlertEvaluatorService,
  ) {}

  @Post('rules')
  @ApiOperation({ summary: 'Create an alert rule' })
  create(@Body() dto: CreateRuleDto) {
    return this.alerts.create(dto);
  }

  @Get('rules')
  @ApiOperation({ summary: 'List rules (with their latest firing)' })
  list() {
    return this.alerts.list();
  }

  @Get('rules/:id')
  @ApiOperation({ summary: 'One rule + its recent firings' })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.alerts.get(id);
  }

  @Patch('rules/:id')
  @ApiOperation({ summary: 'Update a rule (partial)' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRuleDto) {
    return this.alerts.update(id, dto);
  }

  @Delete('rules/:id')
  @ApiOperation({ summary: 'Delete a rule (and its event history)' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.alerts.remove(id);
  }

  @Get('events')
  @ApiOperation({ summary: 'Recent alert firings across all rules' })
  @ApiQuery({ name: 'limit', required: false })
  events(@Query('limit') limit?: string) {
    return this.alerts.recentEvents(Number(limit) || 50);
  }

  @Post('evaluate')
  @ApiOperation({
    summary: 'Manually evaluate all rules against the latest ingested day',
    description: 'Idempotent — a rule that already fired today stays quiet.',
  })
  async evaluate(@Query('date') date?: string) {
    if (date) return this.evaluator.evaluateAll(date);
    await this.evaluator.catchUp();
    return { evaluated: true };
  }
}
