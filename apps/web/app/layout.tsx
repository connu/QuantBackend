import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'MarketPulse',
  description: 'NSE market data + alerts',
};

/**
 * ELI5: In Next.js's App Router, layout.tsx wraps every page — the one
 * place for shared chrome like our nav bar. Each folder under app/ with a
 * page.tsx becomes a route (app/rules/page.tsx → /rules).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="top">
          <span className="brand">📈 MarketPulse</span>
          <Link href="/rules">Rules</Link>
          <Link href="/alerts">Alerts</Link>
          <Link href="/chart">Chart</Link>
          <Link href="/system">System</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
