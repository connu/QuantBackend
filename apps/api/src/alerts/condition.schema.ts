import { z } from 'zod';

/**
 * ELI5: A rule's condition is structured JSON, NOT a mini-language.
 *
 *   "RELIANCE crosses above its 200DMA":
 *   { "all": [ { "indicator": "close", "op": "crosses_above",
 *                "rhs": { "indicator": "sma", "params": { "n": 200 } } } ] }
 *
 *   "Nifty PE above 25":
 *   { "all": [ { "indicator": "pe", "op": "gt", "value": 25 } ] }
 *
 * Why not let users type "close > sma(200)"? Because then we'd own a parser,
 * a grammar, syntax errors, precedence bugs... Structured JSON gets the same
 * power, is trivially validated by this schema, and a web form can build it
 * with dropdowns. Rule of thumb: don't invent a language until JSON hurts.
 *
 * Each leaf compares an INDICATOR either to a fixed number (`value`) or to
 * another indicator (`rhs`). `all` = every leaf must hold (AND). An OR can
 * simply be two rules — cheaper than nesting boolean trees.
 */

export const STOCK_INDICATORS = [
  'close',
  'sma', // params.n
  'ema', // params.n
  'week52_high',
  'week52_low',
  'volume',
  'avg_volume', // params.n
  'pct_change', // params.n (days), in %
] as const;

export const INDEX_INDICATORS = ['close', 'pe', 'pb', 'div_yield', 'sma', 'pct_change'] as const;

const sideSchema = z.object({
  indicator: z.string(),
  params: z.record(z.string(), z.number()).optional(),
});

const leafSchema = z
  .object({
    indicator: z.string(),
    params: z.record(z.string(), z.number()).optional(),
    op: z.enum(['gt', 'gte', 'lt', 'lte', 'crosses_above', 'crosses_below']),
    value: z.number().optional(),
    rhs: sideSchema.optional(),
  })
  .refine((l) => (l.value !== undefined) !== (l.rhs !== undefined), {
    message: 'exactly one of `value` or `rhs` is required',
  });

export const conditionSchema = z.object({
  all: z.array(leafSchema).min(1).max(5),
});

export type Condition = z.infer<typeof conditionSchema>;
export type ConditionLeaf = Condition['all'][number];
export type IndicatorSide = z.infer<typeof sideSchema>;

/** Validate a condition against the indicator set for its target type. */
export function validateCondition(raw: unknown, targetType: 'STOCK' | 'INDEX'): Condition {
  const cond = conditionSchema.parse(raw);
  const allowed: readonly string[] =
    targetType === 'STOCK' ? STOCK_INDICATORS : INDEX_INDICATORS;

  for (const leaf of cond.all) {
    for (const ind of [leaf.indicator, leaf.rhs?.indicator].filter(Boolean) as string[]) {
      if (!allowed.includes(ind)) {
        throw new Error(
          `indicator '${ind}' not available for ${targetType} rules (allowed: ${allowed.join(', ')})`,
        );
      }
    }
  }
  return cond;
}
