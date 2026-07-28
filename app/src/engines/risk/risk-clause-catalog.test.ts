import { describe, expect, it } from 'vitest';
import { ALL_CLAUSE_TYPES, getClausesForCategory, getRefinedClausesForSignal, getClauseEntry } from './risk-clause-catalog';
import type { RiskCategory, RiskSignal, ClauseType } from './risk-types';

describe('risk clause catalog', () => {
  it('covers all 38 clause types', () => {
    expect(ALL_CLAUSE_TYPES).toHaveLength(38);
  });

  it('every category has default clauses', () => {
    const categories: RiskCategory[] = [
      'market', 'technology', 'customer', 'financial', 'financing',
      'legal_compliance', 'governance', 'data_authenticity', 'exit',
    ];
    for (const cat of categories) {
      expect(getClausesForCategory(cat).length).toBeGreaterThan(0);
    }
  });

  it('every signal has refined clauses within its category', () => {
    const signals: RiskSignal[] = [
      'market_adoption', 'valuation_overhang', 'technical_feasibility', 'ip_ownership',
      'customer_concentration', 'revenue_quality', 'cash_runway', 'reporting_quality',
      'financing_dependency', 'regulatory_approval', 'key_person', 'governance_control',
      'data_integrity', 'exit_delay',
    ];
    for (const sig of signals) {
      expect(getRefinedClausesForSignal(sig).length).toBeGreaterThan(0);
    }
  });

  it('every clause type has a catalog entry with required fields', () => {
    for (const ct of ALL_CLAUSE_TYPES) {
      const entry = getClauseEntry(ct);
      expect(entry.clauseType).toBe(ct);
      expect(entry.applicability.length).toBeGreaterThan(0);
      expect(entry.protectionMechanism.length).toBeGreaterThan(0);
      expect(['transfer', 'constraint', 'verification_condition', 'partial_mitigation']).toContain(entry.riskTreatment);
      expect(entry.sideEffects.length).toBeGreaterThan(0);
    }
  });
});
