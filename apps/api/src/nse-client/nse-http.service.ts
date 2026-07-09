import { Injectable, Logger } from '@nestjs/common';

/**
 * Thrown when NSE has no file at that URL (HTTP 404). This is NOT an error
 * condition for us — it usually means "holiday we didn't know about" or
 * "today's file isn't published yet". Callers catch it and mark the day
 * SKIPPED instead of failing the job.
 */
export class NseFileNotFoundError extends Error {
  constructor(url: string) {
    super(`NSE has no file at ${url}`);
    this.name = 'NseFileNotFoundError';
  }
}

/**
 * ELI5: The ONE door through which all NSE traffic leaves this app.
 *
 * NSE's servers reject clients that look like scripts, and will block IPs
 * that hammer them. So every download goes through this service, which:
 *   1. sends browser-like headers (or NSE answers 403),
 *   2. queues requests so at most ONE is in flight, with a polite gap
 *      between them (rate limiting),
 *   3. retries transient failures with exponential backoff (2s, 4s, 8s...),
 *      but NEVER retries a 404 — "file doesn't exist" won't change.
 *
 * Because providers are singletons, every module that injects this shares
 * the same queue — nobody can accidentally bypass the politeness.
 */
@Injectable()
export class NseHttpService {
  private readonly logger = new Logger(NseHttpService.name);

  // Promise chain = a queue with zero bookkeeping: each download awaits the
  // previous one's completion (plus the gap), whatever order callers arrive.
  private chain: Promise<unknown> = Promise.resolve();

  private static readonly GAP_MS = 2_000;
  private static readonly MAX_ATTEMPTS = 3;

  private static readonly HEADERS = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://www.nseindia.com/',
  };

  // Cookies for www.nseindia.com. The archives host serves files to anyone
  // with browser headers, but the main site's API endpoints refuse clients
  // without a session cookie — you must "visit the homepage" first, like a
  // browser would. We cache that session and refresh it every few minutes.
  private sessionCookie = '';
  private sessionFetchedAt = 0;
  private static readonly SESSION_TTL_MS = 5 * 60_000;

  /**
   * Download a file as a Buffer, politely.
   * `withSession: true` for www.nseindia.com API endpoints (cookie needed).
   */
  download(url: string, opts: { withSession?: boolean } = {}): Promise<Buffer> {
    // Append our download to the chain; the chain itself never rejects
    // (failures belong to the caller, not to the queue).
    const result = this.chain.then(() => this.fetchWithRetry(url, opts.withSession));
    this.chain = result.catch(() => undefined).then(() => sleep(NseHttpService.GAP_MS));
    return result;
  }

  private async getSessionCookie(): Promise<string> {
    const age = Date.now() - this.sessionFetchedAt;
    if (this.sessionCookie && age < NseHttpService.SESSION_TTL_MS) {
      return this.sessionCookie;
    }
    this.logger.debug('Warming up NSE session (homepage visit for cookies)');
    const res = await fetch('https://www.nseindia.com/', {
      headers: NseHttpService.HEADERS,
    });
    // getSetCookie() returns each Set-Cookie header; we send back the
    // name=value pairs like a browser would on the next request.
    const cookies = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    if (!cookies) throw new Error('NSE homepage returned no session cookies');
    this.sessionCookie = cookies;
    this.sessionFetchedAt = Date.now();
    return cookies;
  }

  private async fetchWithRetry(url: string, withSession?: boolean): Promise<Buffer> {
    for (let attempt = 1; ; attempt++) {
      try {
        // Cookie fetched INSIDE the loop: if attempt 1 fails with 401/403
        // (stale session), we drop the cookie and attempt 2 warms a new one.
        const cookie = withSession ? await this.getSessionCookie() : undefined;
        this.logger.debug(`GET ${url} (attempt ${attempt})`);
        const res = await fetch(url, {
          headers: cookie
            ? { ...NseHttpService.HEADERS, Cookie: cookie }
            : NseHttpService.HEADERS,
        });

        if (res.status === 404) throw new NseFileNotFoundError(url);
        if (res.status === 401 || res.status === 403) {
          this.sessionCookie = ''; // force a fresh warm-up on retry
          throw new Error(`HTTP ${res.status} from ${url} (session rejected)`);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        // 404 is a fact, not a glitch — no retry will change it.
        if (err instanceof NseFileNotFoundError) throw err;
        if (attempt >= NseHttpService.MAX_ATTEMPTS) throw err;

        const backoff = 2_000 * 2 ** (attempt - 1);
        this.logger.warn(`${String(err)} — retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
