import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { validateCondition } from './condition.schema';
import { CreateRuleDto, UpdateRuleDto } from './dto/create-rule.dto';

/**
 * ELI5: Plain CRUD for alert rules. The one interesting job: conditions are
 * arbitrary JSON to the database, so THIS is the gate where they're proven
 * well-formed (zod schema + "does this indicator exist for this target
 * type"). Bad rules bounce at creation with a helpful message — not at
 * 8 PM inside the evaluator.
 */
@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRuleDto) {
    const condition = this.parseCondition(dto.condition, dto.targetType);
    return this.prisma.alertRule.create({
      data: {
        name: dto.name,
        targetType: dto.targetType,
        symbol: dto.symbol.toUpperCase(),
        condition,
        cooldownDays: dto.cooldownDays ?? 7,
        active: dto.active ?? true,
      },
    });
  }

  list() {
    return this.prisma.alertRule.findMany({
      orderBy: { id: 'asc' },
      include: {
        events: { orderBy: { triggeredOn: 'desc' }, take: 1 },
      },
    });
  }

  async get(id: number) {
    const rule = await this.prisma.alertRule.findUnique({
      where: { id },
      include: { events: { orderBy: { triggeredOn: 'desc' }, take: 10 } },
    });
    if (!rule) throw new NotFoundException(`No rule with id ${id}`);
    return rule;
  }

  async update(id: number, dto: UpdateRuleDto) {
    const existing = await this.get(id);
    const targetType = dto.targetType ?? existing.targetType;
    const condition =
      dto.condition !== undefined
        ? this.parseCondition(dto.condition, targetType)
        : undefined;

    return this.prisma.alertRule.update({
      where: { id },
      data: {
        name: dto.name,
        targetType: dto.targetType,
        symbol: dto.symbol?.toUpperCase(),
        condition,
        cooldownDays: dto.cooldownDays,
        active: dto.active,
      },
    });
  }

  async remove(id: number) {
    await this.get(id); // 404 if absent
    await this.prisma.alertRule.delete({ where: { id } });
    return { deleted: id };
  }

  recentEvents(limit = 50) {
    return this.prisma.alertEvent.findMany({
      orderBy: { id: 'desc' },
      take: Math.min(limit, 200),
      include: { rule: { select: { name: true, symbol: true } } },
    });
  }

  private parseCondition(raw: unknown, targetType: 'STOCK' | 'INDEX') {
    try {
      return validateCondition(raw, targetType);
    } catch (err) {
      throw new BadRequestException(`Invalid condition: ${String(err)}`);
    }
  }
}
