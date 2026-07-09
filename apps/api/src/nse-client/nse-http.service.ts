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

  /** Download a file as a Buffer, politely. */
  download(url: string): Promise<Buffer> {
    // Append our download to the chain; the chain itself never rejects
    // (failures belong to the caller, not to the queue).
    const result = this.chain.then(() => this.fetchWithRetry(url));
    this.chain = result.catch(() => undefined).then(() => sleep(NseHttpService.GAP_MS));
    return result;
  }

  private async fetchWithRetry(url: string): Promise<Buffer> {
    for (let attempt = 1; ; attempt++) {
      try {
        this.logger.debug(`GET ${url} (attempt ${attempt})`);
        const res = await fetch(url, { headers: NseHttpService.HEADERS });

        if (res.status === 404) throw new NseFileNotFoundError(url);
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
