import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';

/**
 * One parsed price row, still as strings. We keep numbers as strings all the
 * way to Prisma, which feeds them to Postgres NUMERIC columns exactly —
 * never through JavaScript floats (0.1 + 0.2 === 0.30000000000000004).
 */
export interface BhavcopyRow {
  symbol: string;
  series: string;
  isin: string | null;
  open: string;
  high: string;
  low: string;
  close: string;
  prevClose: string | null;
  volume: bigint;
  turnover: string | null;
  totalTrades: number | null;
}

// Only cash-equity series. The bhavcopy also carries ETFs, G-secs, rights
// entitlements... — noise for a stock alert engine.
//   EQ = normal rolling settlement, BE = trade-for-trade,
//   SM/ST = SME platform stocks.
const WANTED_SERIES = new Set(['EQ', 'BE', 'SM', 'ST']);

/**
 * ELI5: NSE publishes each day's closing prices as a zip containing one CSV
 * (the "bhavcopy" — bhav is Hindi for price). Since July 2024 it uses the
 * "UDiFF" column layout, ISO-terminology column names like TckrSymb.
 *
 * This is a pure function: bytes in, rows out. No HTTP, no database, no
 * clock. That makes it trivially testable with a saved sample file.
 */
export function parseBhavcopy(zipBuffer: Buffer): BhavcopyRow[] {
  const entries = new AdmZip(zipBuffer).getEntries();
  const csvEntry = entries.find((e) => e.entryName.endsWith('.csv'));
  if (!csvEntry) throw new Error('Bhavcopy zip contains no CSV file');

  const records: Record<string, string>[] = parse(csvEntry.getData(), {
    columns: true, // first line = header row → objects keyed by column name
    skip_empty_lines: true,
    trim: true,
  });

  return records
    .filter((r) => WANTED_SERIES.has(r.SctySrs))
    .map((r) => ({
      symbol: r.TckrSymb,
      series: r.SctySrs,
      isin: r.ISIN || null,
      open: r.OpnPric,
      high: r.HghPric,
      low: r.LwPric,
      close: r.ClsPric,
      prevClose: r.PrvsClsgPric || null,
      volume: BigInt(r.TtlTradgVol || '0'),
      turnover: r.TtlTrfVal || null,
      totalTrades: r.TtlNbOfTxsExctd ? Number(r.TtlNbOfTxsExctd) : null,
    }));
}
