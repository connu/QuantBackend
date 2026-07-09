import { Injectable, NotFoundException } from '@nestjs/common';
import { toDbDate } from '../common/trading-days';
import { PrismaService } from '../database/prisma.service';

export interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  revision: number;
}

/**
 * ELI5: The reading room. Everything write-side (ingestion, backfill, CA
 * sync) is elsewhere; this service only answers questions:
 *
 *  - "RELIANCE, last 300 days, adjusted"  → for charts & indicators
 *  - "NIFTY 50 with P/E, last year"       → for index alerts
 *  - "...as we believed it on March 3rd"  → point-in-time (audit/backtest)
 *
 * Two ideas matter here:
 *
 * ADJUSTED PRICES are computed at read time: raw rows × the product of all
 * adjustment factors with ex_date AFTER that row's date. Store raw forever,
 * derive views on demand — derived data is cheap,原data is sacred.
 *
 * AS-OF QUERIES use the revision bookkeeping: a row was "believed" at time T
 * if its ingestion run finished before T AND it wasn't superseded until
 * after T. That's a plain WHERE clause — no snapshots to store, ever.
 */
@Injectable()
export class MarketDataService {
  constructor(private readonly prisma: PrismaService) {}

  async priceSeries(opts: {
    symbol: string;
    from: string;
    to: string;
    adjusted: boolean;
    asOf?: string; // ISO timestamp — "what did we believe at this moment?"
  }): Promise<PricePoint[]> {
    const symbol = opts.symbol.toUpperCase();

    const rows = opts.asOf
      ? await this.asOfRows(symbol, opts.from, opts.to, new Date(opts.asOf))
      : await this.prisma.eodPrice.findMany({
          where: {
            symbol,
            supersededAt: null, // "current belief" — the 99% case
            tradeDate: { gte: toDbDate(opts.from), lte: toDbDate(opts.to) },
          },
          orderBy: { tradeDate: 'asc' },
        });

    if (rows.length === 0) return [];

    // Cumulative factor per row: product of factors with exDate > row date.
    // Walking from the newest row backwards makes it O(n): cross an ex-date
    // → multiply it in; everything older inherits it automatically.
    const factors = opts.adjusted
      ? await this.prisma.adjustmentFactor.findMany({
          where: { symbol },
          orderBy: { exDate: 'desc' },
        })
      : [];

    const out: PricePoint[] = new Array(rows.length);
    let cum = 1;
    let fi = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      while (fi < factors.length && factors[fi].exDate > r.tradeDate) {
        cum *= Number(factors[fi].factor);
        fi++;
      }
      out[i] = {
        date: r.tradeDate.toISOString().slice(0, 10),
        // Floats are fine HERE: this is the presentation/indicator boundary,
        // not storage. The database keeps exact decimals forever.
        open: Number(r.open) * cum,
        high: Number(r.high) * cum,
        low: Number(r.low) * cum,
        close: Number(r.close) * cum,
        volume: Number(r.volume),
        revision: r.revision,
      };
    }
    return out;
  }

  /**
   * Rows as believed at time T — the revision bookkeeping earning its keep.
   * A row was "current knowledge" at T iff:
   *   - its ingestion run had finished by T (it existed), AND
   *   - it wasn't superseded yet at T (or never was).
   * Raw SQL because it joins ingestion_runs, and the join is the lesson.
   */
  private async asOfRows(symbol: string, from: string, to: string, asOf: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        trade_date: Date;
        open: string;
        high: string;
        low: string;
        close: string;
        volume: bigint;
        revision: number;
      }>
    >`
      SELECT p.trade_date, p.open, p.high, p.low, p.close, p.volume, p.revision
      FROM eod_prices p
      JOIN ingestion_runs r ON r.id = p.ingestion_run_id
      WHERE p.symbol = ${symbol}
        AND p.trade_date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)}
        AND r.finished_at <= ${asOf}
        AND (p.superseded_at IS NULL OR p.superseded_at > ${asOf})
      ORDER BY p.trade_date ASC`;

    return rows.map((r) => ({
      tradeDate: r.trade_date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      revision: r.revision,
    }));
  }

  async indexSeries(indexName: string, from: string, to: string) {
    const rows = await this.prisma.indexValue.findMany({
      where: {
        indexName: { equals: indexName, mode: 'insensitive' },
        supersededAt: null,
        tradeDate: { gte: toDbDate(from), lte: toDbDate(to) },
      },
      orderBy: { tradeDate: 'asc' },
    });
    return rows.map((r) => ({
      date: r.tradeDate.toISOString().slice(0, 10),
      close: Number(r.close),
      pe: r.pe === null ? null : Number(r.pe),
      pb: r.pb === null ? null : Number(r.pb),
      divYield: r.divYield === null ? null : Number(r.divYield),
    }));
  }

  async searchSymbols(q: string) {
    return this.prisma.instrument.findMany({
      where: { symbol: { contains: q.toUpperCase() } },
      take: 20,
      orderBy: { symbol: 'asc' },
    });
  }
}
