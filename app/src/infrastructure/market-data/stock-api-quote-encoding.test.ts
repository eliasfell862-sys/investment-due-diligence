import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStockQuotes } from './stock-api';

function gbkQuoteBytes(): ArrayBuffer {
  const fields = Array.from({ length: 50 }, () => '0');
  fields[0] = '51';
  fields[2] = '000333';
  fields[3] = '82.81';
  fields[4] = '83.03';
  const prefix = new TextEncoder().encode(`v_sz000333="${fields[0]}~`);
  const name = Uint8Array.from([0xc3, 0xc0, 0xb5, 0xc4, 0xbc, 0xaf, 0xcd, 0xc5]);
  const suffix = new TextEncoder().encode(`~${fields.slice(2).join('~')}";`);
  const body = new Uint8Array(prefix.length + name.length + suffix.length);
  body.set(prefix);
  body.set(name, prefix.length);
  body.set(suffix, prefix.length + name.length);
  return body.buffer;
}

class FakeQuoteXhr {
  static last: FakeQuoteXhr | null = null;
  responseType = '';
  response: ArrayBuffer = gbkQuoteBytes();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  constructor() { FakeQuoteXhr.last = this; }
  open() {}
  send() { this.onload?.(); }
}

describe('browser quote encoding', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests raw bytes and decodes Tencent names as GBK', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeQuoteXhr);

    const quotes = await fetchStockQuotes(['000333']);

    expect(FakeQuoteXhr.last?.responseType).toBe('arraybuffer');
    expect(quotes[0]?.name).toBe('美的集团');
  });
});