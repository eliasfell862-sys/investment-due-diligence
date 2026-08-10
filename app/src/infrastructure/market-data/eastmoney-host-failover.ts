/**
 * Eastmoney quote API host failover.
 *
 * push2.eastmoney.com is the primary host for the quote / clist APIs (个股基本面、
 * 资金流、目录等). On some networks it is intermittently unreachable — TCP
 * connects but the response is dropped (HTTP 000) — while push2his / push2delay
 * serve the same endpoints and stay stable. We therefore retry across all three
 * hosts before giving up, so a flapping primary host no longer takes down the
 * whole page.
 */

export const EASTMONEY_QUOTE_HOSTS = [
  'push2.eastmoney.com',
  'push2his.eastmoney.com',
  'push2delay.eastmoney.com',
] as const;

export type HostAwareRequest = (url: string, timeoutMs: number) => Promise<unknown>;

/** Swap the Eastmoney quote host inside a URL (no-op if not the primary host). */
export function replaceEastmoneyHost(url: string, host: string): string {
  return url.replace('push2.eastmoney.com', host);
}

/**
 * Run `request` against each Eastmoney quote host for `url` (primary host
 * first), returning the first successful result. When every host fails,
 * rethrow the last error so the caller can degrade gracefully.
 */
export async function requestWithEastmoneyFailover(
  url: string,
  request: HostAwareRequest,
  timeoutMs: number,
): Promise<unknown> {
  let lastError: unknown;
  for (const host of EASTMONEY_QUOTE_HOSTS) {
    try {
      return await request(replaceEastmoneyHost(url, host), timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
