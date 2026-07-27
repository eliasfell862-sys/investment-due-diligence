import { DomainContractError } from '../../domain/analysis/value';

interface SnapshotContext {
  readonly active: WeakSet<object>;
  readonly memo: WeakMap<object, object>;
  nodeCount: number;
  arraySlots: number;
  propertyCount: number;
  stringCharacters: number;
}

const MAX_DTO_NODES = 16384;
const MAX_DTO_DEPTH = 64;
const MAX_ARRAY_LENGTH = 4096;
const MAX_TOTAL_ARRAY_SLOTS = 32768;
const MAX_OBJECT_PROPERTIES = 4096;
const MAX_TOTAL_PROPERTIES = 32768;
const MAX_STRING_LENGTH = 65536;
const MAX_TOTAL_STRING_CHARACTERS = 1048576;

function invalidDto(): never {
  throw new DomainContractError('invalid_dto');
}

function snapshotString(value: string, context: SnapshotContext): string {
  context.stringCharacters += value.length;
  if (
    value.length > MAX_STRING_LENGTH ||
    context.stringCharacters > MAX_TOTAL_STRING_CHARACTERS
  ) {
    return invalidDto();
  }
  return value;
}

function snapshotArray(
  value: unknown[],
  context: SnapshotContext,
  depth: number,
): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return invalidDto();
  }

  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_ARRAY_LENGTH
  ) {
    return invalidDto();
  }

  const length = lengthDescriptor.value;
  context.arraySlots += length;
  if (context.arraySlots > MAX_TOTAL_ARRAY_SLOTS) {
    return invalidDto();
  }

  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) {
    return invalidDto();
  }

  const output: unknown[] = [];
  context.memo.set(value, output);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      return invalidDto();
    }
    output.push(snapshotValue(descriptor.value, context, depth + 1));
  }
  return output;
}

function snapshotObject(
  value: object,
  context: SnapshotContext,
  depth: number,
): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidDto();
  }

  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_OBJECT_PROPERTIES) {
    return invalidDto();
  }
  context.propertyCount += keys.length;
  if (context.propertyCount > MAX_TOTAL_PROPERTIES) {
    return invalidDto();
  }

  const output = Object.create(prototype) as Record<string, unknown>;
  context.memo.set(value, output);
  for (const key of keys) {
    if (typeof key !== 'string') {
      return invalidDto();
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      return invalidDto();
    }
    Object.defineProperty(output, key, {
      value: snapshotValue(descriptor.value, context, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return output;
}

function snapshotValue(
  value: unknown,
  context: SnapshotContext,
  depth: number,
): unknown {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return snapshotString(value, context);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : invalidDto();
  }
  if (typeof value !== 'object' || depth > MAX_DTO_DEPTH) {
    return invalidDto();
  }
  if (context.active.has(value)) {
    return invalidDto();
  }

  const cached = context.memo.get(value);
  if (cached !== undefined) {
    return cached;
  }
  context.nodeCount += 1;
  if (context.nodeCount > MAX_DTO_NODES) {
    return invalidDto();
  }

  context.active.add(value);
  try {
    return Array.isArray(value)
      ? snapshotArray(value, context, depth)
      : snapshotObject(value, context, depth);
  } finally {
    context.active.delete(value);
  }
}

export function snapshotForecastInput(input: unknown): unknown {
  try {
    return snapshotValue(input, {
      active: new WeakSet<object>(),
      memo: new WeakMap<object, object>(),
      nodeCount: 0,
      arraySlots: 0,
      propertyCount: 0,
      stringCharacters: 0,
    }, 0);
  } catch {
    return invalidDto();
  }
}
