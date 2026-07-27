import { describe, expect, it } from 'vitest';

import { DomainContractError } from '../../domain/analysis/value';
import { capTableInput } from './equity-test-fixtures';
import { snapshotEquityInput } from './snapshot-equity-input';

function invalid(action: () => unknown): void {
  expect(action).toThrowError(
    expect.objectContaining<Partial<DomainContractError>>({ code: 'invalid_dto' }),
  );
}

describe('snapshotEquityInput', () => {
  it('detaches DTOs while preserving shared aliases', () => {
    const shared = { value: '1' };
    const input = { capTable: capTableInput(), values: [shared, shared] };
    const snapshot = snapshotEquityInput(input) as typeof input;
    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
    expect(snapshot.values[0]).toBe(snapshot.values[1]);
    expect(snapshot.values[0]).not.toBe(shared);
  });

  it('rejects sparse arrays, accessors, cycles, symbols, and class instances', () => {
    const sparse = new Array(2);
    sparse[0] = capTableInput().initialPositions[0];
    invalid(() => snapshotEquityInput({ ...capTableInput(), initialPositions: sparse }));

    const accessor = capTableInput() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'version', { enumerable: true, get: () => '1' });
    invalid(() => snapshotEquityInput(accessor));

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    invalid(() => snapshotEquityInput(cyclic));
    invalid(() => snapshotEquityInput({ [Symbol('x')]: true }));
    invalid(() => snapshotEquityInput(new (class EquityDto {})()));
  });

  it('rejects hostile proxies and bounded-resource violations', () => {
    invalid(() => snapshotEquityInput(new Proxy(capTableInput(), {
      ownKeys(): never { throw new Error('hostile'); },
    })));
    invalid(() => snapshotEquityInput({ value: 'x'.repeat(65537) }));
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 66; index += 1) deep = { child: deep };
    invalid(() => snapshotEquityInput(deep));
    invalid(() => snapshotEquityInput({ values: new Array(4097) }));
  });
});
