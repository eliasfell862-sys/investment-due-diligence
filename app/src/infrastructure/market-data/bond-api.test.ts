import { describe, expect, it } from 'vitest';
import { parseTencentConvertibleBonds } from './bond-api';

describe('convertible bond market data', () => {
  it('represents unavailable derived fields as missing instead of zero', () => {
    const fields = Array.from({ length: 40 }, () => '');
    fields[1] = 'test bond';
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

  it('uses the correct exchange prefix for Shenzhen and Shanghai bond families', () => {
    const fields = Array.from({ length: 40 }, () => '');
    fields[1] = 'mapped bond';
    fields[3] = '100';
    const row = fields.join('~');
    const payload = [
      'v_sz123111="' + row + '";',
      'v_sz127001="' + row + '";',
      'v_sz128001="' + row + '";',
      'v_sh110043="' + row + '";',
      'v_sh113050="' + row + '";',
    ].join(String.fromCharCode(10));

    const bonds = parseTencentConvertibleBonds(
      payload,
      ['123111', '127001', '128001', '110043', '113050'],
    );

    expect(bonds.map((bond) => bond.code)).toEqual([
      '123111', '127001', '128001', '110043', '113050',
    ]);
  });});
