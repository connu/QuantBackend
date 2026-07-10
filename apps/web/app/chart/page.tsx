'use client';

/**
 * Price chart: single-series line (close, adjusted by default), built as
 * plain SVG — no chart library. Follows the dataviz method: one validated
 * series hue, thin 2px line, recessive grid, crosshair + tooltip on hover,
 * and a table view for accessibility. Single series → no legend; the title
 * names it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';

interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const W = 920;
const H = 360;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

export default function ChartPage() {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [input, setInput] = useState('RELIANCE');
  const [adjusted, setAdjusted] = useState(true);
  const [months, setMonths] = useState(12);
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [error, setError] = useState('');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const load = useCallback(() => {
    const to = new Date().toISOString().slice(0, 10);
    const fromD = new Date();
    fromD.setMonth(fromD.getMonth() - months);
    const from = fromD.toISOString().slice(0, 10);
    setError('');
    apiGet<PricePoint[]>(
      `/market-data/prices/${encodeURIComponent(symbol)}?from=${from}&to=${to}&adjusted=${adjusted}`,
    )
      .then((p) => {
        setPoints(p);
        if (p.length === 0) setError(`No data for ${symbol} — is the backfill still running?`);
      })
      .catch((e) => setError(String(e)));
  }, [symbol, adjusted, months]);
  useEffect(load, [load]);

  // Scales: index → x, close → y (nice min/max padding).
  const { path, xFor, yFor, ticks } = useMemo(() => {
    if (points.length < 2) return { path: '', xFor: () => 0, yFor: () => 0, ticks: [] as number[] };
    const closes = points.map((p) => p.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const padV = (max - min || max * 0.1) * 0.06;
    const lo = min - padV;
    const hi = max + padV;
    const xFor = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
    const yFor = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const path = closes.map((c, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(c).toFixed(1)}`).join('');
    // ~4 recessive horizontal gridlines at round-ish values.
    const step = (hi - lo) / 4;
    const ticks = [0, 1, 2, 3, 4].map((k) => lo + k * step);
    return { path, xFor, yFor, ticks };
  }, [points]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (points.length < 2 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (x - PAD.left) / (W - PAD.left - PAD.right);
    const i = Math.round(frac * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const hp = hover !== null ? points[hover] : null;
  const first = points[0]?.close;
  const last = points[points.length - 1]?.close;
  const pct = first && last ? ((last - first) / first) * 100 : null;

  return (
    <>
      <h1>Chart</h1>
      <p className="sub">Daily closes from your own database. Adjusted prices multiply out splits and bonuses.</p>

      <div className="row" style={{ marginBottom: 14 }}>
        <form
          onSubmit={(e) => { e.preventDefault(); setSymbol(input.trim().toUpperCase()); }}
          className="row"
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} style={{ width: 160 }} aria-label="Symbol" />
          <button className="primary" type="submit">Load</button>
        </form>
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Range">
          <option value={3}>3 months</option>
          <option value={6}>6 months</option>
          <option value={12}>1 year</option>
          <option value={24}>2 years</option>
        </select>
        <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={adjusted} onChange={(e) => setAdjusted(e.target.checked)} />
          adjusted
        </label>
      </div>

      {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}

      {points.length >= 2 && (
        <div className="card" style={{ padding: 12, position: 'relative' }}>
          <div style={{ padding: '2px 6px 8px' }}>
            <b>{symbol}</b>{' '}
            <span className="muted">close · {adjusted ? 'adjusted' : 'raw'} · {points.length} sessions</span>
            {pct !== null && (
              <span className={pct >= 0 ? 'pos' : 'neg'} style={{ float: 'right', fontWeight: 600 }}>
                {pct >= 0 ? '+' : ''}{pct.toFixed(2)}% over range
              </span>
            )}
          </div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: '100%', height: 'auto', display: 'block' }}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={`${symbol} closing price line chart`}
          >
            {/* recessive grid + y labels (text tokens, not series color) */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={yFor(t)} y2={yFor(t)}
                  stroke="var(--border)" strokeWidth="1" />
                <text x={PAD.left - 8} y={yFor(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                  {t >= 1000 ? t.toFixed(0) : t.toFixed(1)}
                </text>
              </g>
            ))}
            {/* x labels: first / middle / last date */}
            {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => (
              <text key={i} x={xFor(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
                {points[i].date}
              </text>
            ))}
            {/* the series — 2px line, validated hue */}
            <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" />
            {/* crosshair + hovered point */}
            {hp && hover !== null && (
              <g>
                <line x1={xFor(hover)} x2={xFor(hover)} y1={PAD.top} y2={H - PAD.bottom}
                  stroke="var(--muted)" strokeWidth="1" strokeDasharray="3,3" />
                <circle cx={xFor(hover)} cy={yFor(hp.close)} r="4"
                  fill="var(--series-1)" stroke="var(--bg)" strokeWidth="2" />
              </g>
            )}
          </svg>
          {hp && hover !== null && (
            <div
              style={{
                position: 'absolute',
                left: `calc(${(xFor(hover) / W) * 100}% ${xFor(hover) > W * 0.7 ? '- 170px' : '+ 14px'})`,
                top: 48,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12.5,
                pointerEvents: 'none',
                boxShadow: '0 4px 14px rgba(0,0,0,.12)',
              }}
            >
              <b>{hp.date}</b>
              <div>close ₹{hp.close.toFixed(2)}</div>
              <div className="muted">O {hp.open.toFixed(2)} · H {hp.high.toFixed(2)} · L {hp.low.toFixed(2)}</div>
              <div className="muted">vol {Intl.NumberFormat('en-IN').format(hp.volume)}</div>
            </div>
          )}
          <style>{`
            :root { --series-1: #2a78d6; }
            @media (prefers-color-scheme: dark) { :root { --series-1: #3987e5; } }
          `}</style>
        </div>
      )}

      {points.length >= 2 && (
        <details>
          <summary className="muted" style={{ cursor: 'pointer', marginBottom: 8 }}>
            Data table ({points.length} rows)
          </summary>
          <table>
            <thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead>
            <tbody>
              {[...points].reverse().slice(0, 250).map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td><td>{p.open.toFixed(2)}</td><td>{p.high.toFixed(2)}</td>
                  <td>{p.low.toFixed(2)}</td><td>{p.close.toFixed(2)}</td>
                  <td>{Intl.NumberFormat('en-IN').format(p.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}
