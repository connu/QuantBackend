import { parse } from 'csv-parse/sync';

export interface ParsedAction {
  symbol: string;
  series: string;
  exDate: string; // 'YYYY-MM-DD'
  purpose: string; // NSE's raw wording, kept verbatim
  actionType: 'SPLIT' | 'BONUS' | 'DIVIDEND' | 'OTHER';
  /** SPLIT/BONUS: one old share "becomes" ratioNew/ratioOld shares. */
  ratioNew: number | null;
  ratioOld: number | null;
  dividendAmount: number | null;
}

/**
 * ELI5: NSE announces corporate actions as free-text "purpose" strings:
 *
 *   "FACE VALUE SPLIT (SUB-DIVISION) - FROM RS 10/- PER SHARE TO RE 1/- PER SHARE"
 *   "BONUS 1:2"
 *   "INTERIM DIVIDEND - RS 8.50 PER SHARE"
 *
 * We keep the raw string forever (it's the source of truth) and ALSO parse
 * it into structured fields. Unparseable purposes become OTHER with null
 * ratios — never a guess. A wrong adjustment factor silently corrupts every
 * adjusted price; a missing one is at least visible.
 */
export function parsePurpose(
  purpose: string,
): Pick<ParsedAction, 'actionType' | 'ratioNew' | 'ratioOld' | 'dividendAmount'> {
  const p = purpose.toUpperCase();

  // SPLIT: "FROM RS 10 ... TO RS 2" / "FROM RE 1 ... TO ..." (RS/RE, /- noise)
  if (p.includes('SPLIT') || p.includes('SUB-DIVISION') || p.includes('SUBDIVISION')) {
    const m = p.match(/FROM\s+R[SE]\.?\s*([\d.]+).*?TO\s+R[SE]\.?\s*([\d.]+)/);
    if (m) {
      const [oldFv, newFv] = [Number(m[1]), Number(m[2])];
      if (oldFv > 0 && newFv > 0 && oldFv !== newFv) {
        // FV 10 → 2: each share becomes 5 shares.
        return { actionType: 'SPLIT', ratioNew: oldFv, ratioOld: newFv, dividendAmount: null };
      }
    }
    return { actionType: 'SPLIT', ratioNew: null, ratioOld: null, dividendAmount: null };
  }

  // BONUS A:B — A free shares for every B held.
  if (p.includes('BONUS')) {
    const m = p.match(/BONUS\s+(\d+)\s*:\s*(\d+)/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (a > 0 && b > 0) {
        // Hold B, receive A → B shares become A+B.
        return { actionType: 'BONUS', ratioNew: a + b, ratioOld: b, dividendAmount: null };
      }
    }
    return { actionType: 'BONUS', ratioNew: null, ratioOld: null, dividendAmount: null };
  }

  // DIVIDEND - RS 5 / RE 0.50 (possibly "RS.5", "RS 5.50 PER SHARE")
  if (p.includes('DIVIDEND')) {
    const m = p.match(/R[SE]\.?\s*([\d.]+)/);
    return {
      actionType: 'DIVIDEND',
      ratioNew: null,
      ratioOld: null,
      dividendAmount: m ? Number(m[1]) : null,
    };
  }

  return { actionType: 'OTHER', ratioNew: null, ratioOld: null, dividendAmount: null };
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** '09-Jul-2026' → '2026-07-09' (NSE's date style in this feed). */
export function parseNseDate(raw: string): string | null {
  const m = raw?.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].toUpperCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1].padStart(2, '0')}`;
}

/** Parse the corporate-actions CSV export from nseindia.com. */
export function parseCorporateActionsCsv(csv: Buffer): ParsedAction[] {
  const records: Record<string, string>[] = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true, // NSE prepends a UTF-8 byte-order mark; don't let it poison the first header
  });

  const out: ParsedAction[] = [];
  for (const r of records) {
    // Column names as exported ("SYMBOL", "SERIES", "PURPOSE", "EX-DATE").
    const symbol = r.SYMBOL ?? r.Symbol;
    const purpose = r.PURPOSE ?? r.Purpose;
    const exDate = parseNseDate(r['EX-DATE'] ?? r['EX DATE'] ?? '');
    if (!symbol || !purpose || !exDate) continue;

    out.push({
      symbol,
      series: r.SERIES ?? 'EQ',
      exDate,
      purpose,
      ...parsePurpose(purpose),
    });
  }
  return out;
}
