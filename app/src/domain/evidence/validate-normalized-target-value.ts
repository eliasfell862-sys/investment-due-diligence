import Decimal from 'decimal.js';
import type { TargetFieldDefinition } from './target-fields';

export type NormalizedTargetValueInvalidReason =
  | 'invalid-number'
  | 'invalid-date';

export type NormalizedTargetValueValidation =
  | { readonly status: 'empty' }
  | { readonly status: 'valid'; readonly canonicalValue: string }
  | {
      readonly status: 'invalid';
      readonly reason: NormalizedTargetValueInvalidReason;
    };

const canonicalIsoDatePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRealCanonicalIsoDate(value: string): boolean {
  if (!canonicalIsoDatePattern.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1]!;
}

function isFiniteDecimal(value: string): boolean {
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}

export function validateNormalizedTargetValue(
  definition: TargetFieldDefinition,
  normalizedValue: string,
): NormalizedTargetValueValidation {
  const canonicalValue = normalizedValue.normalize('NFC').trim();
  if (canonicalValue.length === 0) {
    return { status: 'empty' };
  }

  if (definition.valueKind === 'number') {
    return isFiniteDecimal(canonicalValue)
      ? { status: 'valid', canonicalValue }
      : { status: 'invalid', reason: 'invalid-number' };
  }

  if (definition.valueKind === 'period') {
    return isRealCanonicalIsoDate(canonicalValue)
      ? { status: 'valid', canonicalValue }
      : { status: 'invalid', reason: 'invalid-date' };
  }

  return { status: 'valid', canonicalValue };
}
