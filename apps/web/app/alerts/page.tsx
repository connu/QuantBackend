'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';

interface AlertEvent {
  id: number;
  triggeredOn: string;
  createdAt: string;
  details: { reasons?: string[] };
  rule: { name: string; symbol: string };
}

export default function AlertsPage() {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<AlertEvent[]>('/alerts/events?limit=100')
      .then(setEvents)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <>
      <h1>Alert feed</h1>
      <p className="sub">Every rule firing, newest first. Emails mirror this list.</p>
      {error && <div className="err">{error}</div>}
      <table>
        <thead>
          <tr><th>Date</th><th>Rule</th><th>Symbol</th><th>Why it fired</th></tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="muted">{e.triggeredOn.slice(0, 10)}</td>
              <td><b>{e.rule.name}</b></td>
              <td>{e.rule.symbol}</td>
              <td>{(e.details.reasons ?? []).join('; ')}</td>
            </tr>
          ))}
          {events.length === 0 && !error && (
            <tr><td colSpan={4} className="muted">Nothing has fired yet.</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
