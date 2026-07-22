import { canonicalizeEnUsNumber } from './canonicalize-en-us-number';
import { canonicalizeFinancialPeriod } from './canonicalize-financial-period';
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

export function validateNormalizedTargetValue(
  definition: TargetFieldDefinition,
  normalizedValue: string,
): NormalizedTargetValueValidation {
  const canonicalValue = normalizedValue.normalize('NFC').trim();
  if (canonicalValue.length === 0) {
    return { status: 'empty' };
  }

  if (definition.valueKind === 'number') {
    const numberValue = canonicalizeEnUsNumber(canonicalValue);
    return numberValue.status === 'valid'
      ? {
          status: 'valid',
          canonicalValue: numberValue.canonicalValue,
        }
      : { status: 'invalid', reason: 'invalid-number' };
  }

  if (definition.valueKind === 'period') {
    const periodValue = canonicalizeFinancialPeriod(canonicalValue);
    return periodValue.status === 'valid'
      ? {
          status: 'valid',
          canonicalValue: periodValue.canonicalValue,
        }
      : { status: 'invalid', reason: 'invalid-date' };
  }

  return { status: 'valid', canonicalValue };
}
