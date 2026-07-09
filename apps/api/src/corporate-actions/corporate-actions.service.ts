import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { previousDay, toDbDate, todayInIndia } from '../common/trading-days';
import { PrismaService } from '../database/prisma.service';
import { IngestionSource, RunStatus } from '../generated/prisma/enums';
import { NseHttpService } from '../nse-client/nse-http.service';
import { parseCorporateActionsCsv, ParsedAction } from './parsers/ca.parser';

/**
 * ELI5: Why do we care about corporate actions at all?
 *
 * On 2024-10-28, Reliance shares "dropped" from ~₹2,660 to ~₹1,340 overnight.
 * Nobody lost money — it was a 1:1 bonus: every holder got a free share, so
 * each share is worth half. But a naive chart (and a naive 200DMA!) sees a
 * 50% crash. Every indicator we compute would scream nonsense.
 *
 * The fix: an ADJUSTMENT FACTOR per (symbol, ex-date). To compare history
 * across the event, multiply all prices BEFORE the ex-date by the factor
 * (0.5 for that bonus). Raw stored prices are NEVER modified — adjustment
 * happens at read time (see MarketDataService). Dividends don't adjust
 * prices in our series (standard for split/bonus-adjusted charts).
 */
@Injectable()
export class CorporateActionsService {
  private readonly logger = new Logger(CorporateActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nse: NseHttpService,
  ) {}

  /** Nightly, before EOD ingestion: pick up newly announced actions. */
  @Cron('0 19 * * 1-5', { name: 'ca-sync', timeZone: 'Asia/Kolkata' })
  async syncRecent() {
    const to = todayInIndia();
    const from = shiftDays(to, -14); // small overlap; upserts make it harmless
    await this.sync(from, to);
  }

  /**
   * Fetch NSE's corporate-actions feed for [from, to] and upsert.
   * Long ranges are chunked ~6 months per request to keep responses sane.
   */
  async sync(from: string, to: string) {
    let upserted = 0;
    const symbols = new Set<string>();

    for (const [f, t] of chunkRange(from, to, 180)) {
      // NB: NSE renamed this endpoint (was .../corporates-corporate-actions);
      // found the current name inside the CA page's JS bundle.
      const url =
        'https://www.nseindia.com/api/corporates-corporateActions' +
        `?index=equities&csv=true&from_date=${toDdMmYyyySlashless(f)}&to_date=${toDdMmYyyySlashless(t)}`;

      const buf = await this.nse.download(url, { withSession: true });
      const actions = parseCorporateActionsCsv(buf);

      for (const a of actions) {
        await this.upsertAction(a);
        upserted++;
        symbols.add(a.symbol);
      }
      this.logger.log(`CA sync ${f}→${t}: ${actions.length} actions`);
    }

    // Factors are derived data — recompute from scratch for touched symbols.
    for (const symbol of symbols) await this.recomputeFactors(symbol);

    await this.prisma.ingestionRun.create({
      data: {
        source: IngestionSource.CORPORATE_ACTIONS,
        tradeDate: toDbDate(todayInIndia()),
        status: RunStatus.SUCCESS,
        finishedAt: new Date(),
        rowCount: upserted,
        error: `range ${from} → ${to}`,
      },
    });
    return { from, to, actions: upserted, symbolsTouched: symbols.size };
  }

  private async upsertAction(a: ParsedAction) {
    await this.prisma.corporateAction.upsert({
      where: {
        symbol_exDate_purpose: {
          symbol: a.symbol,
          exDate: toDbDate(a.exDate),
          purpose: a.purpose,
        },
      },
      create: {
        symbol: a.symbol,
        series: a.series,
        exDate: toDbDate(a.exDate),
        purpose: a.purpose,
        actionType: a.actionType,
        ratioNew: a.ratioNew,
        ratioOld: a.ratioOld,
        dividendAmount: a.dividendAmount,
      },
      // Re-announcements can refine the parse; raw purpose stays the key.
      update: {
        actionType: a.actionType,
        ratioNew: a.ratioNew,
        ratioOld: a.ratioOld,
        dividendAmount: a.dividendAmount,
      },
    });
  }

  /**
   * factor = ratioOld / ratioNew, i.e. "multiply pre-ex prices by this".
   * SPLIT FV 10→2 : ratio 5/1  → factor 0.2
   * BONUS 1:1     : ratio 2/1  → factor 0.5
   * Same-day split+bonus: factors multiply into one row.
   */
  async recomputeFactors(symbol: string) {
    const actions = await this.prisma.corporateAction.findMany({
      where: {
        symbol,
        actionType: { in: ['SPLIT', 'BONUS'] },
        ratioNew: { not: null },
        ratioOld: { not: null },
      },
    });

    // Group by ex-date, multiply.
    const byDate = new Map<string, number>();
    for (const a of actions) {
      const key = a.exDate.toISOString().slice(0, 10);
      const f = Number(a.ratioOld) / Number(a.ratioNew);
      byDate.set(key, (byDate.get(key) ?? 1) * f);
    }

    await this.prisma.$transaction([
      this.prisma.adjustmentFactor.deleteMany({ where: { symbol } }),
      this.prisma.adjustmentFactor.createMany({
        data: [...byDate.entries()].map(([exDate, factor]) => ({
          symbol,
          exDate: toDbDate(exDate),
          factor,
        })),
      }),
    ]);
  }
}

/** '2026-07-10' → '10-07-2026' (what the CA endpoint's query params want). */
function toDdMmYyyySlashless(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}

function shiftDays(isoDate: string, days: number): string {
  const d = toDbDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Split [from,to] into ≤maxDays windows: [['2024-07-10','2025-01-05'], ...] */
function chunkRange(from: string, to: string, maxDays: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let start = from;
  while (start <= to) {
    const end = shiftDays(start, maxDays - 1);
    out.push([start, end > to ? to : end]);
    start = shiftDays(end, 1);
  }
  return out;
}
