import { describe, expect, it } from 'vitest';
import { parseTencentConvertibleBonds } from './bond-api';

describe('convertible bond market data', () => {
  it('represents unavailable derived fields as missing instead of zero', () => {
    const fields = Array.from({ length: 40 }, () => '');
    fields[1] = '????';
    fields[3] = '123.45';
    fields[6] = '1000';
    fields[32] = '1.25';
    const payload = `v_sz123111="${fields.join('~')}";`;

    const [bond] = parseTencentConvertibleBonds(payload, ['123111']);

    expect(bond).toMatchObject({
      code: '123111',
      price: 123.45,
      changePct: 1.25,
      convertPrice: null,
      premium: null,
      stockPrice: null,
      stockChangePct: null,
      yieldToMaturity: null,
    });
  });
});
