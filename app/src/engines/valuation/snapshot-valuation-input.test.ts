import { describe, expect, it } from 'vitest';

import { DomainContractError } from '../../domain/analysis/value';
import { dcfInput } from './valuation-test-fixtures';
import { snapshotValuationInput } from './snapshot-valuation-input';

function expectInvalidDto(action: () => unknown): DomainContractError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainContractError);
    expect(error).toMatchObject({ code: 'invalid_dto' });
    return error as DomainContractError;
  }
  throw new Error('Expected invalid_dto');
}

describe('snapshotValuationInput', () => {
  it('returns a detached snapshot and preserves shared aliases', () => {
    const shared = { value: '1' };
    const input = { request: dcfInput(), aliases: [shared, shared] };
    const snapshot = snapshotValuationInput(input) as typeof input;

    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
    expect(snapshot.request).not.toBe(input.request);
    expect(snapshot.aliases[0]).toBe(snapshot.aliases[1]);
    expect(snapshot.aliases[0]).not.toBe(shared);
  });

  it.each([
    ['class instance', Object.assign(new (class ValuationDto {})(), dcfInput())],
    ['non-finite number', { ...dcfInput(), invalid: Number.NaN }],
    ['symbol key', Object.assign(dcfInput(), { [Symbol('hidden')]: true })],
  ])('rejects a %s', (_label, input) => {
    expectInvalidDto(() => snapshotValuationInput(input));
  });

  it('rejects sparse arrays and accessors', () => {
    const sparse = new Array(3);
    sparse[0] = dcfInput().modelYears[0];
    sparse[2] = dcfInput().modelYears[2];
    expectInvalidDto(() => snapshotValuationInput({ ...dcfInput(), modelYears: sparse }));

    const accessor = dcfInput() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'version', {
      enumerable: true,
      get: () => '1',
    });
    expectInvalidDto(() => snapshotValuationInput(accessor));
  });

  it('rejects cycles and hostile proxies with fresh domain errors', () => {
    const cyclic = dcfInput() as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    const first = expectInvalidDto(() => snapshotValuationInput(cyclic));
    const second = expectInvalidDto(() => snapshotValuationInput(cyclic));
    expect(first).not.toBe(second);

    const hostile = new Proxy(dcfInput(), {
      ownKeys(): never {
        throw new RangeError('hostile ownKeys');
      },
    });
    expectInvalidDto(() => snapshotValuationInput(hostile));
  });

  it('rejects oversized arrays before invoking ownKeys', () => {
    let ownKeysCalls = 0;
    const values = new Proxy(new Array(4097), {
      ownKeys(target) {
        ownKeysCalls += 1;
        return Reflect.ownKeys(target);
      },
    });

    expectInvalidDto(() => snapshotValuationInput({ values }));
    expect(ownKeysCalls).toBe(0);
  });

  it('rejects overlong strings, excessive depth, and excessive nodes', () => {
    expectInvalidDto(() => snapshotValuationInput({ value: 'x'.repeat(65537) }));

    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 66; index += 1) deep = { child: deep };
    expectInvalidDto(() => snapshotValuationInput(deep));

    expectInvalidDto(() => snapshotValuationInput({
      values: Array.from(
        { length: 4096 },
        () => [{ value: '1' }, { value: '2' }, { value: '3' }, { value: '4' }, { value: '5' }],
      ),
    }));
  });
});
