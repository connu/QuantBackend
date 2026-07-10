'use client';

/**
 * ELI5: 'use client' marks this as a browser component (state, clicks,
 * fetches from the user's machine). The form below is exactly the "build
 * the condition JSON with dropdowns" promise from docs/07 — pick indicator,
 * operator, and either a number or another indicator; we assemble the JSON.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '../../lib/api';

interface Rule {
  id: number;
  name: string;
  targetType: 'STOCK' | 'INDEX';
  symbol: string;
  condition: unknown;
  active: boolean;
  cooldownDays: number;
  events: { triggeredOn: string }[];
}

const STOCK_INDICATORS = ['close', 'sma', 'ema', 'week52_high', 'week52_low', 'volume', 'avg_volume', 'pct_change'];
const INDEX_INDICATORS = ['close', 'pe', 'pb', 'div_yield', 'sma', 'pct_change'];
const OPS = ['gt', 'gte', 'lt', 'lte', 'crosses_above', 'crosses_below'];
const NEEDS_N = new Set(['sma', 'ema', 'avg_volume', 'pct_change']);

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState('');

  // form state
  const [name, setName] = useState('');
  const [targetType, setTargetType] = useState<'STOCK' | 'INDEX'>('STOCK');
  const [symbol, setSymbol] = useState('');
  const [indicator, setIndicator] = useState('close');
  const [indicatorN, setIndicatorN] = useState('');
  const [op, setOp] = useState('crosses_above');
  const [rhsKind, setRhsKind] = useState<'value' | 'indicator'>('indicator');
  const [value, setValue] = useState('');
  const [rhsIndicator, setRhsIndicator] = useState('sma');
  const [rhsN, setRhsN] = useState('200');

  const refresh = useCallback(() => {
    apiGet<Rule[]>('/alerts/rules').then(setRules).catch((e) => setError(String(e)));
  }, []);
  useEffect(refresh, [refresh]);

  const indicators = targetType === 'STOCK' ? STOCK_INDICATORS : INDEX_INDICATORS;

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const side = (ind: string, n: string) =>
      NEEDS_N.has(ind) && n ? { indicator: ind, params: { n: Number(n) } } : { indicator: ind };
    const leaf: Record<string, unknown> = { ...side(indicator, indicatorN), op };
    if (rhsKind === 'value') leaf.value = Number(value);
    else leaf.rhs = side(rhsIndicator, rhsN);

    try {
      await apiSend('POST', '/alerts/rules', {
        name: name || `${symbol} ${indicator} ${op} ${rhsKind === 'value' ? value : rhsIndicator}`,
        targetType,
        symbol,
        condition: { all: [leaf] },
      });
      setName(''); setSymbol(''); setValue('');
      refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <>
      <h1>Alert rules</h1>
      <p className="sub">Evaluated automatically after each day&apos;s NSE close lands (~7:15 PM IST).</p>

      <form className="card" onSubmit={createRule}>
        <div className="row" style={{ marginBottom: 10 }}>
          <select value={targetType} onChange={(e) => setTargetType(e.target.value as 'STOCK' | 'INDEX')}>
            <option value="STOCK">Stock</option>
            <option value="INDEX">Index</option>
          </select>
          <input
            required
            placeholder={targetType === 'STOCK' ? 'Symbol, e.g. RELIANCE' : 'Index, e.g. NIFTY 50'}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{ width: 200 }}
          />
          <input placeholder="Rule name (optional)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        </div>
        <div className="row">
          <select value={indicator} onChange={(e) => setIndicator(e.target.value)}>
            {indicators.map((i) => <option key={i}>{i}</option>)}
          </select>
          {NEEDS_N.has(indicator) && (
            <input placeholder="n" value={indicatorN} onChange={(e) => setIndicatorN(e.target.value)} style={{ width: 64 }} />
          )}
          <select value={op} onChange={(e) => setOp(e.target.value)}>
            {OPS.map((o) => <option key={o}>{o}</option>)}
          </select>
          <select value={rhsKind} onChange={(e) => setRhsKind(e.target.value as 'value' | 'indicator')}>
            <option value="indicator">vs indicator…</option>
            <option value="value">vs number…</option>
          </select>
          {rhsKind === 'value' ? (
            <input required placeholder="e.g. 25" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 100 }} />
          ) : (
            <>
              <select value={rhsIndicator} onChange={(e) => setRhsIndicator(e.target.value)}>
                {indicators.map((i) => <option key={i}>{i}</option>)}
              </select>
              {NEEDS_N.has(rhsIndicator) && (
                <input placeholder="n" value={rhsN} onChange={(e) => setRhsN(e.target.value)} style={{ width: 64 }} />
              )}
            </>
          )}
          <button className="primary" type="submit">Create rule</button>
        </div>
        {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
      </form>

      <table>
        <thead>
          <tr><th>Rule</th><th>Target</th><th>Condition</th><th>Last fired</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td><b>{r.name}</b></td>
              <td>{r.symbol}<span className="muted"> · {r.targetType.toLowerCase()}</span></td>
              <td><code className="cond">{JSON.stringify(r.condition)}</code></td>
              <td className="muted">{r.events[0]?.triggeredOn?.slice(0, 10) ?? '—'}</td>
              <td>
                <button
                  className="ghost"
                  title="toggle"
                  onClick={() => apiSend('PATCH', `/alerts/rules/${r.id}`, { active: !r.active }).then(refresh)}
                >
                  <span className={`pill ${r.active ? 'on' : 'off'}`}>{r.active ? 'active' : 'paused'}</span>
                </button>
              </td>
              <td>
                <button className="ghost" onClick={() => apiSend('DELETE', `/alerts/rules/${r.id}`).then(refresh)}>✕</button>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr><td colSpan={6} className="muted">No rules yet — create your first one above.</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
