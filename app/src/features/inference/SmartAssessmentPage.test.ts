import { beforeEach, describe, expect, it } from 'vitest';
import { loadFacts } from './SmartAssessmentPage';

describe('SmartAssessmentPage fact bridge', () => {
  beforeEach(() => localStorage.clear());

  it('loads cap table, round terms, and fatal flaw statuses for downstream engines', () => {
    const projectId = 'bridge-test';
    localStorage.setItem(`dd-p-${projectId}-equity`, JSON.stringify([
      { name: 'Founder', shares: '800', pct: '80', class_: 'Common' },
      { name: 'Seed', shares: '200', pct: '20', class_: 'Preferred' },
    ]));
    localStorage.setItem(`dd-p-${projectId}-invest`, '1000');
    localStorage.setItem(`dd-p-${projectId}-esop`, '10');
    localStorage.setItem(`dd-p-${projectId}-risk-items`, JSON.stringify([
      { riskId: 'r1', category: 'market', title: 'Adoption', probability: '0.5', impact: '0.8', mitigationEffectiveness: '0' },
    ]));
    localStorage.setItem(`dd-p-${projectId}-fatal-flaws`, JSON.stringify([
      { fatalFlawId: 'material_data_or_business_fraud', status: 'clear', evidenceRefs: [] },
    ]));

    const facts = loadFacts(projectId);
    const byMetric = new Map(facts.map(fact => [fact.metricId, fact.value]));
    expect(byMetric.get('cap_table_json')).toContain('Founder');
    expect(byMetric.get('investment_amount')).toBe('1000');
    expect(byMetric.get('esop_pct')).toBe('10');
    expect(byMetric.get('fatal_flaw_material_data_or_business_fraud')).toBe('clear');
    expect(byMetric.get('risk_items_json')).toContain('Adoption');
  });

  it('loads share price and diluted shares for listed-company market cap', () => {
    const projectId = 'listed-project';
    localStorage.setItem(`dd-p-${projectId}-valuation`, JSON.stringify({
      sharePrice: '12.5', fullyDilutedShares: '1000',
    }));
    const facts = loadFacts(projectId);
    const byMetric = new Map(facts.map(fact => [fact.metricId, fact.value]));
    expect(byMetric.get('share_price')).toBe('12.5');
    expect(byMetric.get('fully_diluted_shares')).toBe('1000');
  });

  it('marks all six fatal flaws unassessed when no review has been saved', () => {
    const facts = loadFacts('new-project');
    const fatalFacts = facts.filter(fact => fact.metricId.startsWith('fatal_flaw_'));
    expect(fatalFacts).toHaveLength(6);
    expect(fatalFacts.every(fact => fact.value === 'unassessed')).toBe(true);
  });
});