import { IndicatorSide } from './condition.schema';

/**
 * ELI5: Pure math, no NestJS, no database. Given aligned arrays (one entry
 * per trading day, oldest → newest), compute an indicator's value AT one
 * index. The evaluator asks for index `last` (today) and `last-1`
 * (yesterday) — yesterday is what makes "crosses above" detectable.
 *
 * Returning `null` means "not enough history" (e.g. SMA-200 with 40 days).
 * Null never triggers an alert — silence over false alarms.
 */
export interface Series {
  closes: number[];
  volumes: number[];
  /** Index-only extras (null for stocks): */
  pe?: (number | null)[];
  pb?: (number | null)[];
  divYield?: (number | null)[];
}

export function indicatorAt(series: Series, side: IndicatorSide, i: number): number | null {
  if (i < 0 || i >= series.closes.length) return null;
  const n = side.params?.n ?? defaultN(side.indicator);

  switch (side.indicator) {
    case 'close':
      return series.closes[i];

    case 'sma': {
      if (i + 1 < n) return null;
      let sum = 0;
      for (let k = i - n + 1; k <= i; k++) sum += series.closes[k];
      return sum / n;
    }

    case 'ema': {
      if (i + 1 < n) return null;
      // Standard recipe: seed with the SMA of the first n closes, then fold.
      let ema = 0;
      for (let k = 0; k < n; k++) ema += series.closes[k];
      ema /= n;
      const alpha = 2 / (n + 1);
      for (let k = n; k <= i; k++) ema = series.closes[k] * alpha + ema * (1 - alpha);
      return ema;
    }

    case 'week52_high': {
      const from = Math.max(0, i - 251); // ~252 trading days in a year
      return Math.max(...series.closes.slice(from, i + 1));
    }
    case 'week52_low': {
      const from = Math.max(0, i - 251);
      return Math.min(...series.closes.slice(from, i + 1));
    }

    case 'volume':
      return series.volumes[i];

    case 'avg_volume': {
      if (i + 1 < n) return null;
      let sum = 0;
      for (let k = i - n + 1; k <= i; k++) sum += series.volumes[k];
      return sum / n;
    }

    case 'pct_change': {
      if (i < n) return null;
      const then = series.closes[i - n];
      return then === 0 ? null : ((series.closes[i] - then) / then) * 100;
    }

    case 'pe':
      return series.pe?.[i] ?? null;
    case 'pb':
      return series.pb?.[i] ?? null;
    case 'div_yield':
      return series.divYield?.[i] ?? null;

    default:
      return null;
  }
}

function defaultN(indicator: string): number {
  switch (indicator) {
    case 'sma':
    case 'ema':
      return 200; // "the" moving average unless told otherwise
    case 'avg_volume':
      return 20;
    case 'pct_change':
      return 1;
    default:
      return 1;
  }
}
