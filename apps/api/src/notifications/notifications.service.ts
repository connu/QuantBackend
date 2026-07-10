import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { toDbDate } from '../common/trading-days';
import { ALERTS_TRIGGERED, AlertsTriggeredEvent } from '../alerts/alerts.events';
import { PrismaService } from '../database/prisma.service';
import {
  NOTIFICATION_CHANNEL,
  NotificationChannel,
} from './notification-channel';

/**
 * ELI5: The dispatcher. Composes messages, hands them to the channel seam.
 * Two triggers:
 *
 *  1. ALERTS_TRIGGERED event → one email per evaluation batch, immediately.
 *  2. 21:00 IST cron → the daily digest: market summary + watchlist movers
 *     + today's alerts, whether or not anything fired. (The digest is the
 *     "genuinely useful in daily life" feature: one evening email that
 *     replaces opening three apps.)
 *
 * Note what this class does NOT know: SMTP, ports, passwords. That's all
 * behind the NOTIFICATION_CHANNEL token.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_CHANNEL) private readonly channel: NotificationChannel,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------
  // Immediate alert mail
  // ---------------------------------------------------------------------

  @OnEvent(ALERTS_TRIGGERED)
  async onAlertsTriggered(ev: AlertsTriggeredEvent) {
    const lines = ev.alerts.map(
      (a) => `• ${a.ruleName} [${a.symbol}]\n    ${a.reasons.join('\n    ')}`,
    );
    const date = ev.alerts[0]?.tradeDate ?? '';

    await this.channel.send({
      kind: 'alert',
      alertEventId: ev.alerts[0]?.eventId,
      subject: `🔔 MarketPulse: ${ev.alerts.length} alert${ev.alerts.length > 1 ? 's' : ''} triggered (${date})`,
      text: `Your rules fired after today's close:\n\n${lines.join('\n\n')}\n`,
      html:
        `<h3>Your rules fired after today's close</h3><ul>` +
        ev.alerts
          .map((a) => `<li><b>${a.ruleName}</b> [${a.symbol}]<br>${a.reasons.join('<br>')}</li>`)
          .join('') +
        `</ul>`,
    });
  }

  // ---------------------------------------------------------------------
  // Daily digest
  // ---------------------------------------------------------------------

  @Cron('0 21 * * 1-5', { name: 'daily-digest', timeZone: 'Asia/Kolkata' })
  async sendDailyDigest(): Promise<{ sent: boolean; subject?: string }> {
    const digest = await this.composeDigest();
    if (!digest) {
      this.logger.log('No market data for a digest today (holiday?) — skipping');
      return { sent: false };
    }
    await this.channel.send(digest);
    return { sent: true, subject: digest.subject };
  }

  /** Build the digest for the most recent ingested trading day. */
  async composeDigest() {
    const newest = await this.prisma.eodPrice.aggregate({ _max: { tradeDate: true } });
    if (!newest._max.tradeDate) return null;
    const date = newest._max.tradeDate;
    const dateStr = date.toISOString().slice(0, 10);

    // 1) Headline indices.
    const indices = await this.prisma.indexValue.findMany({
      where: {
        tradeDate: date,
        supersededAt: null,
        indexName: { in: ['Nifty 50', 'Nifty Bank', 'Nifty 500'] },
      },
    });

    // 2) Watchlist movers: today's close vs previous close, biggest first.
    const watchlist = await this.prisma.watchlistItem.findMany();
    const movers: string[] = [];
    for (const item of watchlist) {
      const rows = await this.prisma.eodPrice.findMany({
        where: { symbol: item.symbol, series: 'EQ', supersededAt: null, tradeDate: { lte: date } },
        orderBy: { tradeDate: 'desc' },
        take: 2,
      });
      if (rows.length === 2) {
        const [today, prev] = rows.map((r) => Number(r.close));
        const pct = ((today - prev) / prev) * 100;
        movers.push(
          `${item.symbol}: ₹${today.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
        );
      }
    }

    // 3) Today's alert firings.
    const events = await this.prisma.alertEvent.findMany({
      where: { triggeredOn: date },
      include: { rule: { select: { name: true, symbol: true } } },
    });

    const indexLines = indices.map((i) => {
      const pe = i.pe ? ` (PE ${Number(i.pe).toFixed(2)})` : '';
      return `${i.indexName}: ${Number(i.close).toFixed(2)}${pe}`;
    });
    const alertLines = events.map(
      (e) =>
        `• ${e.rule.name} [${e.rule.symbol}]: ${((e.details as { reasons?: string[] }).reasons ?? []).join('; ')}`,
    );

    const text = [
      `MarketPulse daily digest — ${dateStr}`,
      '',
      '— Indices —',
      ...(indexLines.length ? indexLines : ['(no index data)']),
      '',
      '— Your watchlist —',
      ...(movers.length ? movers : ['(watchlist empty — POST /watchlist to add symbols)']),
      '',
      `— Alerts today (${events.length}) —`,
      ...(alertLines.length ? alertLines : ['(none triggered)']),
    ].join('\n');

    return {
      kind: 'digest',
      subject: `📈 MarketPulse digest — ${dateStr}`,
      text,
      html: `<pre style="font-family:ui-monospace,monospace">${text}</pre>`,
    };
  }
}
