import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { previousDay, toDbDate, todayInIndia } from '../common/trading-days';
import { PrismaService } from '../database/prisma.service';
import { AlertRule } from '../generated/prisma/client';
import {
  INGESTION_COMPLETED,
  IngestionCompletedEvent,
} from '../ingestion/ingestion.events';
import { MarketDataService } from '../market-data/market-data.service';
import {
  ALERTS_TRIGGERED,
  AlertsTriggeredEvent,
  TriggeredAlert,
} from './alerts.events';
import { Condition, ConditionLeaf, IndicatorSide } from './condition.schema';
import { indicatorAt, Series } from './indicators';

/**
 * ELI5: The judge. After fresh data lands, it walks every active rule,
 * computes the indicators it mentions for today AND yesterday, and decides:
 * triggered or not?
 *
 * Design points worth noticing:
 *
 * - EVENT-DRIVEN, cron as backup: evaluation runs when ingestion SAYS data
 *   is ready (@OnEvent below), not at a guessed wall-clock time. The 20:30
 *   catch-up cron only matters if the event path failed — and because
 *   evaluation is idempotent (DB dedup), "ran twice" is a non-event.
 *
 * - CROSSES need two days: "close > 200DMA" is state, "close CROSSED ABOVE
 *   200DMA" is a transition — yesterday no, today yes. State-based alerts
 *   nag forever; transition-based alerts fire once, when it happens. That's
 *   also why cooldownDays exists for the state-based ops.
 *
 * - The unique constraint (ruleId, triggeredOn) is the last line of dedup:
 *   even if two evaluations race, Postgres physically rejects the second
 *   event row. Correctness by construction beats correctness by care.
 */
@Injectable()
export class AlertEvaluatorService {
  private readonly logger = new Logger(AlertEvaluatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent(INGESTION_COMPLETED)
  async onIngestionCompleted(ev: IngestionCompletedEvent) {
    // The backfill also emits this event for 2024 dates — evaluating rules
    // against ancient days would be nonsense. Only judge the newest day.
    const newest = await this.prisma.eodPrice.aggregate({ _max: { tradeDate: true } });
    const newestDate = newest._max.tradeDate?.toISOString().slice(0, 10);
    if (ev.tradeDate !== newestDate) return;

    await this.evaluateAll(ev.tradeDate);
  }

  /** Catch-up: if tonight's event path failed, judge the latest day anyway. */
  @Cron('30 20 * * 1-5', { name: 'alert-catchup', timeZone: 'Asia/Kolkata' })
  async catchUp() {
    const newest = await this.prisma.eodPrice.aggregate({ _max: { tradeDate: true } });
    if (!newest._max.tradeDate) return;
    await this.evaluateAll(newest._max.tradeDate.toISOString().slice(0, 10));
  }

  /** Evaluate every active rule against `tradeDate`. Idempotent. */
  async evaluateAll(tradeDate: string): Promise<TriggeredAlert[]> {
    const rules = await this.prisma.alertRule.findMany({ where: { active: true } });
    if (rules.length === 0) return [];

    const triggered: TriggeredAlert[] = [];
    for (const rule of rules) {
      try {
        const result = await this.evaluateRule(rule, tradeDate);
        if (result) triggered.push(result);
      } catch (err) {
        // One broken rule must never silence the others.
        this.logger.error(`Rule ${rule.id} (${rule.name}) failed: ${String(err)}`);
      }
    }

    this.logger.log(
      `Evaluated ${rules.length} rules for ${tradeDate}: ${triggered.length} triggered`,
    );
    if (triggered.length > 0) {
      this.events.emit(ALERTS_TRIGGERED, new AlertsTriggeredEvent(triggered));
    }
    return triggered;
  }

  private async evaluateRule(
    rule: AlertRule,
    tradeDate: string,
  ): Promise<TriggeredAlert | null> {
    // Cooldown: if it fired within the last N days, stay quiet.
    const cooldownStart = new Date(toDbDate(tradeDate));
    cooldownStart.setUTCDate(cooldownStart.getUTCDate() - rule.cooldownDays);
    const recent = await this.prisma.alertEvent.findFirst({
      where: { ruleId: rule.id, triggeredOn: { gt: cooldownStart } },
    });
    if (recent) return null;

    const series = await this.loadSeries(rule, tradeDate);
    if (!series || series.closes.length < 2) return null;

    const last = series.closes.length - 1;
    const cond = rule.condition as unknown as Condition;
    const reasons: string[] = [];

    for (const leaf of cond.all) {
      const reason = this.evaluateLeaf(series, leaf, last);
      if (!reason) return null; // AND semantics: one miss = no alert
      reasons.push(reason);
    }

    // All leaves passed → record the event. The DB's unique constraint is
    // the dedup: a second evaluation of the same day hits P2002 and stops.
    try {
      const event = await this.prisma.alertEvent.create({
        data: {
          ruleId: rule.id,
          triggeredOn: toDbDate(tradeDate),
          details: { reasons, symbol: rule.symbol },
        },
      });
      return {
        eventId: event.id,
        ruleId: rule.id,
        ruleName: rule.name,
        symbol: rule.symbol,
        tradeDate,
        reasons,
      };
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') return null; // already fired today
      throw err;
    }
  }

  /** Truthy result = human-readable reason string; null = leaf not satisfied. */
  private evaluateLeaf(series: Series, leaf: ConditionLeaf, i: number): string | null {
    const lhsNow = indicatorAt(series, leaf, i);
    const lhsPrev = indicatorAt(series, leaf, i - 1);
    const rhsNow = leaf.rhs ? indicatorAt(series, leaf.rhs, i) : leaf.value!;
    const rhsPrev = leaf.rhs ? indicatorAt(series, leaf.rhs, i - 1) : leaf.value!;
    if (lhsNow === null || rhsNow === null) return null;

    const name = describeSide(leaf);
    const rhsName = leaf.rhs ? describeSide(leaf.rhs) : String(leaf.value);
    const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : x.toPrecision(4));

    switch (leaf.op) {
      case 'gt':
        return lhsNow > rhsNow ? `${name} ${fmt(lhsNow)} > ${rhsName} ${fmt(rhsNow)}` : null;
      case 'gte':
        return lhsNow >= rhsNow ? `${name} ${fmt(lhsNow)} ≥ ${rhsName} ${fmt(rhsNow)}` : null;
      case 'lt':
        return lhsNow < rhsNow ? `${name} ${fmt(lhsNow)} < ${rhsName} ${fmt(rhsNow)}` : null;
      case 'lte':
        return lhsNow <= rhsNow ? `${name} ${fmt(lhsNow)} ≤ ${rhsName} ${fmt(rhsNow)}` : null;
      case 'crosses_above':
        return lhsPrev !== null && rhsPrev !== null && lhsPrev <= rhsPrev && lhsNow > rhsNow
          ? `${name} crossed above ${rhsName} (${fmt(lhsPrev)} → ${fmt(lhsNow)} vs ${fmt(rhsNow)})`
          : null;
      case 'crosses_below':
        return lhsPrev !== null && rhsPrev !== null && lhsPrev >= rhsPrev && lhsNow < rhsNow
          ? `${name} crossed below ${rhsName} (${fmt(lhsPrev)} → ${fmt(lhsNow)} vs ${fmt(rhsNow)})`
          : null;
    }
  }

  /** ~420 calendar days ≈ 280 trading days: enough for SMA-200 + a year window. */
  private async loadSeries(rule: AlertRule, tradeDate: string): Promise<Series | null> {
    const from = shiftDays(tradeDate, -420);

    if (rule.targetType === 'STOCK') {
      const points = await this.marketData.priceSeries({
        symbol: rule.symbol,
        from,
        to: tradeDate,
        adjusted: true, // ALWAYS adjusted — raw series scream on every split
      });
      if (points.length === 0) return null;
      return {
        closes: points.map((p) => p.close),
        volumes: points.map((p) => p.volume),
      };
    }

    const points = await this.marketData.indexSeries(rule.symbol, from, tradeDate);
    if (points.length === 0) return null;
    return {
      closes: points.map((p) => p.close),
      volumes: points.map(() => 0),
      pe: points.map((p) => p.pe),
      pb: points.map((p) => p.pb),
      divYield: points.map((p) => p.divYield),
    };
  }
}

function describeSide(side: IndicatorSide): string {
  const n = side.params?.n;
  return n ? `${side.indicator}(${n})` : side.indicator;
}

function shiftDays(isoDate: string, days: number): string {
  const d = toDbDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
