import Decimal from 'decimal.js';

export type EnUsNumberCanonicalization =
  | { readonly status: 'valid'; readonly canonicalValue: string }
  | { readonly status: 'invalid' };

const ungroupedEnUsNumber =
  /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const groupedEnUsNumber = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

export function canonicalizeEnUsNumber(
  value: unknown,
): EnUsNumberCanonicalization {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { status: 'invalid' };
    }
    return { status: 'valid', canonicalValue: new Decimal(value).toString() };
  }

  const textValue = String(value).trim().normalize('NFC');
  if (
    !ungroupedEnUsNumber.test(textValue) &&
    !groupedEnUsNumber.test(textValue)
  ) {
    return { status: 'invalid' };
  }

  try {
    const decimal = new Decimal(textValue.replace(/,/g, ''));
    return decimal.isFinite()
      ? { status: 'valid', canonicalValue: decimal.toString() }
      : { status: 'invalid' };
  } catch {
    return { status: 'invalid' };
  }
}
