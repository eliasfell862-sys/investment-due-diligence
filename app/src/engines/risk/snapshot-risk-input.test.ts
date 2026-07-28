import { describe, expect, it } from 'vitest';

import { DomainContractError } from '../../domain/analysis/value';
import { riskAssessmentInput } from './risk-test-fixtures';
import { snapshotRiskInput } from './snapshot-risk-input';

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

describe('snapshotRiskInput', () => {
  it('returns a detached plain snapshot without mutating aliases', () => {
    const input = riskAssessmentInput();
    const snapshot = snapshotRiskInput(input) as typeof input;

    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
    expect(snapshot.riskItems).not.toBe(input.riskItems);
    expect(snapshot.riskItems[0]).not.toBe(input.riskItems[0]);
    expect(snapshot.fatalFlaws).not.toBe(input.fatalFlaws);
  });

  it('preserves shared alias references', () => {
    const base = riskAssessmentInput();
    const shared = base.riskItems[0]!;
    // Bypass the fixture clone: build input with the same object reference twice.
    const input = { ...base, riskItems: [shared, shared] };
    const snapshot = snapshotRiskInput(input) as typeof input;
    expect(snapshot.riskItems[0]).toBe(snapshot.riskItems[1]);
  });

  it.each([
    ['class instance', Object.assign(new (class RiskDto {})(), riskAssessmentInput())],
    ['non-finite number', { ...riskAssessmentInput(), version: Number.NaN }],
    ['symbol key', Object.assign(riskAssessmentInput(), { [Symbol('hidden')]: true })],
  ])('rejects a %s', (_label, input) => {
    expectInvalidDto(() => snapshotRiskInput(input));
  });

  it('rejects sparse arrays and accessors', () => {
    const sparse = new Array(3);
    sparse[0] = riskAssessmentInput().riskItems[0];
    sparse[2] = riskAssessmentInput().riskItems[0];
    expectInvalidDto(() =>
      snapshotRiskInput({
        ...riskAssessmentInput(),
        riskItems: sparse,
      }),
    );

    const accessor = riskAssessmentInput() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'version', {
      enumerable: true,
      get: () => '1',
    });
    expectInvalidDto(() => snapshotRiskInput(accessor));
  });

  it('rejects cycles and hostile proxy traps as fresh domain errors', () => {
    const cyclic = riskAssessmentInput() as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    const first = expectInvalidDto(() => snapshotRiskInput(cyclic));
    const second = expectInvalidDto(() => snapshotRiskInput(cyclic));
    expect(first).not.toBe(second);

    const hostile = new Proxy(riskAssessmentInput(), {
      ownKeys(): never {
        throw new RangeError('hostile ownKeys');
      },
    });
    expectInvalidDto(() => snapshotRiskInput(hostile));
  });

  it('rejects oversized public arrays before invoking ownKeys', () => {
    let ownKeysCalls = 0;
    const riskItems = new Proxy(new Array(4097), {
      ownKeys(target) {
        ownKeysCalls += 1;
        return Reflect.ownKeys(target);
      },
    });

    expectInvalidDto(() =>
      snapshotRiskInput({
        ...riskAssessmentInput(),
        riskItems,
      }),
    );
    expect(ownKeysCalls).toBe(0);
  });

  it('accepts null-prototype DTOs', () => {
    const raw = riskAssessmentInput({ upstreamSnapshots: {} });
    const nullProto: Record<string, unknown> = Object.create(null);
    nullProto.version = raw.version;
    nullProto.asOfDate = raw.asOfDate;
    nullProto.riskItems = raw.riskItems;
    nullProto.fatalFlaws = raw.fatalFlaws;

    const snapshot = snapshotRiskInput(nullProto) as Record<string, unknown>;
    expect(snapshot.version).toBe('1');
    expect(snapshot.riskItems).toEqual(raw.riskItems);
  });

  it('rejects excessive depth', () => {
    let deep: Record<string, unknown> = riskAssessmentInput() as unknown as Record<string, unknown>;
    for (let index = 0; index < 70; index += 1) {
      deep = { nested: deep };
    }
    expectInvalidDto(() => snapshotRiskInput(deep));
  });

  it('rejects objects with too many properties', () => {
    const fat: Record<string, unknown> = { version: '1', asOfDate: '2026-03-31' };
    for (let index = 0; index < 4100; index += 1) {
      fat[`prop${index}`] = index;
    }
    expectInvalidDto(() => snapshotRiskInput(fat));
  });
});
