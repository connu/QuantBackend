'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';

interface BackfillStatus {
  queue: Record<string, number>;
  ledger: { source: string; successfulDays: number; earliest: string; latest: string }[];
  recentFailures: { jobId: string; tradeDate?: string; reason: string }[];
}
interface Run {
  id: number;
  source: string;
  tradeDate: string;
  status: string;
  rowCount: number | null;
  error: string | null;
  finishedAt: string | null;
}

export default function SystemPage() {
  const [status, setStatus] = useState<BackfillStatus | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => {
      apiGet<BackfillStatus>('/backfill/status').then(setStatus).catch((e) => setError(String(e)));
      apiGet<Run[]>('/ingestion/runs?limit=15').then(setRuns).catch(() => undefined);
    };
    load();
    const t = setInterval(load, 5000); // live-ish while a backfill runs
    return () => clearInterval(t);
  }, []);

  const q = status?.queue;
  const total = q ? q.waiting + q.active + q.completed + q.failed + q.delayed : 0;

  return (
    <>
      <h1>System</h1>
      <p className="sub">Ingestion health — the ledger never lies.</p>
      {error && <div className="err">{error}</div>}

      {q && (
        <div className="card">
          <b>Backfill queue</b>{' '}
          <span className="muted">
            {q.completed}/{total} done · {q.waiting} waiting · {q.active} active ·{' '}
            <span className={q.failed ? 'neg' : ''}>{q.failed} failed</span>
          </span>
          {status!.ledger.map((l) => (
            <div key={l.source} className="muted" style={{ marginTop: 6 }}>
              {l.source}: {l.successfulDays} days ({l.earliest?.slice(0, 10)} → {l.latest?.slice(0, 10)})
            </div>
          ))}
          {status!.recentFailures.length > 0 && (
            <div className="err" style={{ marginTop: 8 }}>
              {status!.recentFailures.map((f) => `${f.tradeDate}: ${f.reason}`).join('\n')}
            </div>
          )}
        </div>
      )}

      <h1 style={{ fontSize: 17 }}>Recent ingestion runs</h1>
      <table>
        <thead>
          <tr><th>#</th><th>Source</th><th>Trade date</th><th>Status</th><th>Rows</th><th>Note</th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="muted">{r.id}</td>
              <td>{r.source}</td>
              <td>{r.tradeDate.slice(0, 10)}</td>
              <td>
                <span className={`pill ${r.status === 'SUCCESS' ? 'on' : 'off'}`}>{r.status}</span>
              </td>
              <td>{r.rowCount ?? '—'}</td>
              <td className="muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
