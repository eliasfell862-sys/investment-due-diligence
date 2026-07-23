export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const nestedValue of Object.values(
    value as Record<string, unknown>,
  )) {
    deepFreeze(nestedValue);
  }

  return Object.freeze(value);
}
