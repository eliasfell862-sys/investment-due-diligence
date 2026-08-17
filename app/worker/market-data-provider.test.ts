import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeMarketDataProvider } from './market-data-provider';

function quoteLine(code: string, price = 10): string {
  const marketCode = `${code.startsWith('6') ? 'sh' : 'sz'}${code}`;
  const fields = Array.from({ length: 50 }, () => '0');
  fields[1] = `股票${code}`;
  fields[3] = String(price);
  fields[4] = '9.8';
  fields[5] = '9.9';
  fields[6] = '1000';
  fields[33] = '10.2';
  fields[34] = '9.7';
  fields[37] = '100000';
  return `v_${marketCode}="${fields.join('~')}";`;
}

describe('Node market data provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads 161 unique quotes in batches of 80, 80, and 1', async () => {
    const requested: string[][] = [];
    const requestText = vi.fn(async (url: string) => {
      const codes = new URL(url).searchParams.get('q')!.split(',').map(value => value.slice(2));
      requested.push(codes);
      return codes.map(code => quoteLine(code)).join('\n');
    });
    const provider = createNodeMarketDataProvider({ requestText });
    const codes = Array.from({ length: 161 }, (_, index) => String(index + 1).padStart(6, '0'));

    const result = await provider.fetchQuotes([...codes, codes[0]]);

    expect(requested.map(batch => batch.length)).toEqual([80, 80, 1]);
    expect(Object.keys(result.quotes)).toHaveLength(161);
    expect(result.failures).toEqual({});
  });

  it('returns missing and zero-price rows as failures', async () => {
    const provider = createNodeMarketDataProvider({
      requestText: async () => quoteLine('000001', 0),
    });

    const result = await provider.fetchQuotes(['000001', '000002']);

    expect(result.quotes).toEqual({});
    expect(Object.keys(result.failures)).toEqual(['000001', '000002']);
  });
  it('decodes Tencent quote names from GBK bytes', async () => {
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const result = await createNodeMarketDataProvider().fetchQuotes(['000333']);

    expect(result.quotes['000333']?.name).toBe('美的集团');
  });
});
