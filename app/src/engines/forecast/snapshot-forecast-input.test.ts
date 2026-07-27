import { describe, expect, it } from 'vitest';

import { DomainContractError } from '../../domain/analysis/value';
import { forecastInput } from './forecast-test-fixtures';
import { snapshotForecastInput } from './snapshot-forecast-input';

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

describe('snapshotForecastInput', () => {
  it('returns a detached plain snapshot without mutating aliases', () => {
    const input = forecastInput();
    const snapshot = snapshotForecastInput(input) as typeof input;

    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
    expect(snapshot.baseline).not.toBe(input.baseline);
    expect(snapshot.scenarios[0]).not.toBe(input.scenarios[0]);
  });

  it.each([
    ['class instance', Object.assign(new (class ForecastDto {})(), forecastInput())],
    ['non-finite number', { ...forecastInput(), baseline: { ...forecastInput().baseline, horizonMonths: Number.NaN } }],
    ['symbol key', Object.assign(forecastInput(), { [Symbol('hidden')]: true })],
  ])('rejects a %s', (_label, input) => {
    expectInvalidDto(() => snapshotForecastInput(input));
  });

  it('rejects sparse arrays and accessors', () => {
    const sparse = new Array(3);
    sparse[0] = forecastInput().scenarios[0];
    sparse[2] = forecastInput().scenarios[2];
    expectInvalidDto(() => snapshotForecastInput({ ...forecastInput(), scenarios: sparse }));

    const accessor = forecastInput() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'version', {
      enumerable: true,
      get: () => '1',
    });
    expectInvalidDto(() => snapshotForecastInput(accessor));
  });

  it('rejects cycles and hostile proxy traps as fresh domain errors', () => {
    const cyclic = forecastInput() as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    const first = expectInvalidDto(() => snapshotForecastInput(cyclic));
    const second = expectInvalidDto(() => snapshotForecastInput(cyclic));
    expect(first).not.toBe(second);

    const hostile = new Proxy(forecastInput(), {
      ownKeys(): never {
        throw new RangeError('hostile ownKeys');
      },
    });
    expectInvalidDto(() => snapshotForecastInput(hostile));
  });

  it('rejects oversized public arrays before invoking ownKeys', () => {
    let ownKeysCalls = 0;
    const scenarios = new Proxy(new Array(4097), {
      ownKeys(target) {
        ownKeysCalls += 1;
        return Reflect.ownKeys(target);
      },
    });

    expectInvalidDto(() => snapshotForecastInput({
      ...forecastInput(),
      scenarios,
    }));
    expect(ownKeysCalls).toBe(0);
  });

  it('rejects overlong strings, excessive depth, and excessive unique nodes', () => {
    expectInvalidDto(() => snapshotForecastInput({
      ...forecastInput(),
      version: 'x'.repeat(65537),
    }));

    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 66; index += 1) {
      deep = { child: deep };
    }
    expectInvalidDto(() => snapshotForecastInput(deep));

    expectInvalidDto(() => snapshotForecastInput({
      values: Array.from({ length: 4096 }, () => [{ value: '1' }, { value: '2' }, { value: '3' }, { value: '4' }, { value: '5' }]),
    }));
  });

  it('preserves shared aliases without counting them as new nodes repeatedly', () => {
    const shared = { value: '1' };
    const input = { values: Array.from({ length: 4096 }, () => shared) };
    const snapshot = snapshotForecastInput(input) as typeof input;

    expect(snapshot.values).toHaveLength(4096);
    expect(snapshot.values[0]).toBe(snapshot.values[4095]);
    expect(snapshot.values[0]).not.toBe(shared);
  });
});
