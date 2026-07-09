import { parse } from 'csv-parse/sync';

export interface IndexRow {
  indexName: string;
  close: string;
  open: string | null;
  high: string | null;
  low: string | null;
  pe: string | null;
  pb: string | null;
  divYield: string | null;
}

/**
 * ELI5: NSE's daily "ind_close_all" CSV has one row per index (NIFTY 50,
 * NIFTY BANK, ...) with close level AND valuation ratios — P/E, P/B,
 * dividend yield. That P/E column is exactly what a "Nifty PE > 25"
 * alert reads. Empty values arrive as "-".
 */
export function parseIndexSnapshot(csvBuffer: Buffer): IndexRow[] {
  const records: Record<string, string>[] = parse(csvBuffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  return records
    .filter((r) => r['Index Name'] && r['Closing Index Value'])
    .map((r) => ({
      indexName: r['Index Name'],
      close: clean(r['Closing Index Value'])!,
      open: clean(r['Open Index Value']),
      high: clean(r['High Index Value']),
      low: clean(r['Low Index Value']),
      pe: clean(r['P/E']),
      pb: clean(r['P/B']),
      divYield: clean(r['Div Yield']),
    }));
}

/** NSE writes missing numbers as '-' (or ''). Normalize to null. */
function clean(v: string | undefined): string | null {
  if (!v || v === '-') return null;
  return v;
}
