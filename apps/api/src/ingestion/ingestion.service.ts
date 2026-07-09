import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'node:crypto';
import { toCompact, toDbDate, toDdmmyyyy, isWeekend } from '../common/trading-days';
import { PrismaService } from '../database/prisma.service';
import {
  NseFileNotFoundError,
  NseHttpService,
} from '../nse-client/nse-http.service';
import { IngestionSource, RunStatus } from '../generated/prisma/enums';
import { parseBhavcopy } from './parsers/bhavcopy.parser';
import { parseIndexSnapshot } from './parsers/index-snapshot.parser';
import { INGESTION_COMPLETED, IngestionCompletedEvent } from './ingestion.events';

export interface SourceOutcome {
  status: RunStatus;
  rows: number;
  note?: string;
}

/**
 * ELI5: The brain of ingestion. For one trading day it:
 *
 *   1. skips weekends/known holidays outright,
 *   2. downloads NSE's files (through the polite shared HTTP client),
 *   3. decides whether there's actually anything NEW (idempotency),
 *   4. writes rows in a single transaction, never overwriting old data
 *      (revisions — see docs/06),
 *   5. records every attempt in the ingestion_runs ledger,
 *   6. announces completion as an event.
 *
 * "Idempotent" is the key property: running this twice for the same day is
 * completely harmless. The second run downloads the file, sees the SHA-256
 * hash matches what the ledger says was already ingested, and stops. That
 * makes retries, crashes, and trigger-happy humans all safe.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nse: NseHttpService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Ingest both sources (equities + indices) for one day.
   *
   * `skipIfIngested` is the backfill fast path: when the ledger already
   * shows a SUCCESS for a source on this day, don't even download — a
   * 500-day backfill that gets restarted should blast through finished
   * days in milliseconds, not re-download a gigabyte to learn nothing.
   * The nightly cron does NOT use it, so late re-publications by NSE are
   * still caught by the hash check.
   */
  async ingestDay(
    tradeDate: string,
    opts: { skipIfIngested?: boolean } = {},
  ): Promise<Record<string, SourceOutcome>> {
    const skip = await this.nonTradingReason(tradeDate);
    if (skip) {
      this.logger.log(`${tradeDate}: ${skip} — skipping`);
      return {
        equities: { status: RunStatus.SKIPPED, rows: 0, note: skip },
        indices: { status: RunStatus.SKIPPED, rows: 0, note: skip },
      };
    }

    const equities = await this.ingestEquities(tradeDate, opts);
    const indices = await this.ingestIndices(tradeDate, opts);

    // Only announce when something new actually landed — listeners treat
    // this as "fresh data exists", so a no-op re-run must stay silent.
    if (equities.rows > 0 || indices.rows > 0) {
      this.events.emit(
        INGESTION_COMPLETED,
        new IngestionCompletedEvent(tradeDate, equities.rows, indices.rows),
      );
    }

    return { equities, indices };
  }

  /** Weekend or seeded holiday? Returns the reason, or null on trading days. */
  private async nonTradingReason(tradeDate: string): Promise<string | null> {
    if (isWeekend(tradeDate)) return 'weekend';
    const holiday = await this.prisma.tradingHoliday.findUnique({
      where: { date: toDbDate(tradeDate) },
    });
    return holiday ? `holiday (${holiday.description})` : null;
  }

  // -------------------------------------------------------------------------
  // Equities
  // -------------------------------------------------------------------------

  private async ingestEquities(
    tradeDate: string,
    opts: { skipIfIngested?: boolean } = {},
  ): Promise<SourceOutcome> {
    const url =
      'https://nsearchives.nseindia.com/content/cm/' +
      `BhavCopy_NSE_CM_0_0_0_${toCompact(tradeDate)}_F_0000.csv.zip`;

    return this.ingestSource(IngestionSource.EQUITY_BHAVCOPY, tradeDate, url, opts, {
      parse: (buf) => parseBhavcopy(buf),
      write: async (tx, rows, runId, revision) => {
        await tx.eodPrice.createMany({
          data: rows.map((r) => ({
            symbol: r.symbol,
            series: r.series,
            tradeDate: toDbDate(tradeDate),
            open: r.open,
            high: r.high,
            low: r.low,
            close: r.close,
            prevClose: r.prevClose,
            volume: r.volume,
            turnover: r.turnover,
            totalTrades: r.totalTrades,
            ingestionRunId: runId,
            revision,
          })),
        });

        // Keep the instrument catalog fresh as a side effect.
        await tx.instrument.createMany({
          data: rows.map((r) => ({
            symbol: r.symbol,
            series: r.series,
            isin: r.isin,
          })),
          skipDuplicates: true,
        });
        await tx.instrument.updateMany({
          where: { symbol: { in: rows.map((r) => r.symbol) } },
          data: { lastSeenAt: new Date() },
        });
      },
      supersede: async (tx) => {
        const res = await tx.eodPrice.updateMany({
          where: { tradeDate: toDbDate(tradeDate), supersededAt: null },
          data: { supersededAt: new Date() },
        });
        return res.count;
      },
      maxRevision: async (tx) => {
        const agg = await tx.eodPrice.aggregate({
          where: { tradeDate: toDbDate(tradeDate) },
          _max: { revision: true },
        });
        return agg._max.revision ?? 0;
      },
    });
  }

  // -------------------------------------------------------------------------
  // Indices
  // -------------------------------------------------------------------------

  private async ingestIndices(
    tradeDate: string,
    opts: { skipIfIngested?: boolean } = {},
  ): Promise<SourceOutcome> {
    const url =
      'https://nsearchives.nseindia.com/content/indices/' +
      `ind_close_all_${toDdmmyyyy(tradeDate)}.csv`;

    return this.ingestSource(IngestionSource.INDEX_SNAPSHOT, tradeDate, url, opts, {
      parse: (buf) => parseIndexSnapshot(buf),
      write: async (tx, rows, runId, revision) => {
        await tx.indexValue.createMany({
          data: rows.map((r) => ({
            indexName: r.indexName,
            tradeDate: toDbDate(tradeDate),
            close: r.close,
            open: r.open,
            high: r.high,
            low: r.low,
            pe: r.pe,
            pb: r.pb,
            divYield: r.divYield,
            ingestionRunId: runId,
            revision,
          })),
        });
      },
      supersede: async (tx) => {
        const res = await tx.indexValue.updateMany({
          where: { tradeDate: toDbDate(tradeDate), supersededAt: null },
          data: { supersededAt: new Date() },
        });
        return res.count;
      },
      maxRevision: async (tx) => {
        const agg = await tx.indexValue.aggregate({
          where: { tradeDate: toDbDate(tradeDate) },
          _max: { revision: true },
        });
        return agg._max.revision ?? 0;
      },
    });
  }

  // -------------------------------------------------------------------------
  // The shared idempotent pipeline (same steps for every source)
  // -------------------------------------------------------------------------

  private async ingestSource<Row>(
    source: IngestionSource,
    tradeDate: string,
    url: string,
    opts: { skipIfIngested?: boolean },
    ops: {
      parse: (buf: Buffer) => Row[];
      write: (
        tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
        rows: Row[],
        runId: number,
        revision: number,
      ) => Promise<void>;
      supersede: (
        tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
      ) => Promise<number>;
      maxRevision: (
        tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
      ) => Promise<number>;
    },
  ): Promise<SourceOutcome> {
    const date = toDbDate(tradeDate);

    // Step 1: what does the ledger already know about this day?
    const priorSuccess = await this.prisma.ingestionRun.findFirst({
      where: { source, tradeDate: date, status: RunStatus.SUCCESS },
      orderBy: { id: 'desc' },
    });

    // Backfill fast path: already done → no download, no new ledger row
    // (a restarted backfill would otherwise flood the ledger with SKIPPEDs).
    if (opts.skipIfIngested && priorSuccess) {
      return { status: RunStatus.SKIPPED, rows: 0, note: 'already ingested' };
    }

    // Step 2: download (may throw NseFileNotFoundError → SKIPPED).
    let buf: Buffer;
    try {
      buf = await this.nse.download(url);
    } catch (err) {
      if (err instanceof NseFileNotFoundError) {
        const note = 'no file on NSE (unlisted holiday, or not published yet)';
        await this.recordRun(source, date, RunStatus.SKIPPED, { error: note });
        return { status: RunStatus.SKIPPED, rows: 0, note };
      }
      await this.recordRun(source, date, RunStatus.FAILED, {
        error: String(err),
      });
      throw err; // real failure → let BullMQ retry the job
    }

    // Step 3: the idempotency check. Same bytes as last success? Done.
    const fileHash = createHash('sha256').update(buf).digest('hex');
    if (priorSuccess?.fileHash === fileHash) {
      const note = 'file identical to previous successful run';
      await this.recordRun(source, date, RunStatus.SKIPPED, { fileHash, error: note });
      return { status: RunStatus.SKIPPED, rows: 0, note };
    }

    const rows = ops.parse(buf);
    if (rows.length === 0) {
      const note = 'file parsed to zero rows';
      await this.recordRun(source, date, RunStatus.FAILED, { fileHash, error: note });
      return { status: RunStatus.FAILED, rows: 0, note };
    }

    // Step 4: write. One transaction = either the whole day lands or none
    // of it. A crash mid-write can't leave half a bhavcopy in the table.
    const run = await this.recordRun(source, date, RunStatus.RUNNING, { fileHash });
    try {
      await this.prisma.$transaction(async (tx) => {
        // If NSE re-published the file (rare but real), don't overwrite:
        // stamp old rows superseded and insert fresh ones as revision N+1.
        const revision = (await ops.maxRevision(tx)) + 1;
        if (priorSuccess) await ops.supersede(tx);
        await ops.write(tx, rows, run.id, revision);
      });

      await this.prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: RunStatus.SUCCESS,
          finishedAt: new Date(),
          rowCount: rows.length,
        },
      });
      this.logger.log(`${tradeDate} ${source}: ${rows.length} rows ingested`);
      return { status: RunStatus.SUCCESS, rows: rows.length };
    } catch (err) {
      await this.prisma.ingestionRun.update({
        where: { id: run.id },
        data: { status: RunStatus.FAILED, finishedAt: new Date(), error: String(err) },
      });
      throw err;
    }
  }

  private recordRun(
    source: IngestionSource,
    tradeDate: Date,
    status: RunStatus,
    extra: { fileHash?: string; error?: string } = {},
  ) {
    return this.prisma.ingestionRun.create({
      data: {
        source,
        tradeDate,
        status,
        finishedAt: status === RunStatus.RUNNING ? null : new Date(),
        ...extra,
      },
    });
  }
}
