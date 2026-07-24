import {
  AnalysisDecimal,
  canonicalDecimal,
  parseDecimalString,
} from './decimal';
import type { ProbabilityString } from './decimal';
import { DomainContractError } from './value';

export const SCENARIO_IDS = ['downside', 'base', 'upside'] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface ScenarioDefinition<T> {
  readonly id: ScenarioId;
  readonly probability: ProbabilityString;
  readonly assumptions: T;
}

export type ScenarioIssueCode =
  | 'invalid_scenario_set'
  | 'invalid_decimal'
  | 'value_out_of_range'
  | 'probability_sum_mismatch';

export type ScenarioValidation<T> =
  | {
      readonly status: 'valid';
      readonly scenarios: readonly ScenarioDefinition<T>[];
    }
  | {
      readonly status: 'invalid';
      readonly issue: { readonly code: ScenarioIssueCode };
    };

interface ParsedScenario<T> {
  readonly id: string;
  readonly probability: string;
  readonly assumptions: T;
}

function invalidDto(): never {
  throw new DomainContractError('invalid_dto');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseScenarioStructure<T>(input: unknown): ParsedScenario<T> {
  if (
    !isPlainRecord(input) ||
    !Object.hasOwn(input, 'id') ||
    !Object.hasOwn(input, 'probability') ||
    !Object.hasOwn(input, 'assumptions')
  ) {
    return invalidDto();
  }

  const id = input.id;
  const probability = input.probability;
  const assumptions = input.assumptions;
  if (
    typeof id !== 'string' ||
    typeof probability !== 'string' ||
    assumptions === undefined
  ) {
    return invalidDto();
  }

  return { id, probability, assumptions: assumptions as T };
}

function parseScenarioArray<T>(input: unknown): readonly ParsedScenario<T>[] {
  try {
    if (!Array.isArray(input)) {
      return invalidDto();
    }

    const length = input.length;
    const scenarios: ParsedScenario<T>[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(input, index)) {
        return invalidDto();
      }
      scenarios.push(parseScenarioStructure<T>(input[index]));
    }
    return scenarios;
  } catch {
    return invalidDto();
  }
}

function invalid<T>(code: ScenarioIssueCode): ScenarioValidation<T> {
  return { status: 'invalid', issue: { code } };
}

function isScenarioId(value: string): value is ScenarioId {
  return SCENARIO_IDS.some((scenarioId) => scenarioId === value);
}

export function validateScenarioSet<T = unknown>(input: unknown): ScenarioValidation<T> {
  const parsed = parseScenarioArray<T>(input);
  if (
    parsed.length !== SCENARIO_IDS.length ||
    parsed.some((scenario) => !isScenarioId(scenario.id)) ||
    new Set(parsed.map((scenario) => scenario.id)).size !== SCENARIO_IDS.length
  ) {
    return invalid('invalid_scenario_set');
  }

  let probabilitySum = new AnalysisDecimal(0);
  for (const scenario of parsed) {
    let probability;
    try {
      probability = parseDecimalString(scenario.probability);
    } catch {
      return invalid('invalid_decimal');
    }

    if (probability.isNegative() || probability.greaterThan(1)) {
      return invalid('value_out_of_range');
    }
    probabilitySum = probabilitySum.plus(probability);
  }

  if (canonicalDecimal(probabilitySum) !== '1') {
    return invalid('probability_sum_mismatch');
  }

  const scenarioById = new Map(parsed.map((scenario) => [scenario.id, scenario]));
  return {
    status: 'valid',
    scenarios: SCENARIO_IDS.map((id) => {
      const scenario = scenarioById.get(id);
      if (scenario === undefined) {
        return invalidDto();
      }
      return {
        id,
        probability: scenario.probability,
        assumptions: scenario.assumptions,
      };
    }),
  };
}
