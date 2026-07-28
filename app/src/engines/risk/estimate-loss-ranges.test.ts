import { describe, expect, it } from 'vitest';
import { estimateLossRanges } from './estimate-loss-ranges';

describe('estimateLossRanges', () => {
  const baseInput = () => ({
    fatalOutcome: 'none' as const,
    notCurableByClause: false,
    overallResidualRisk: '0.1',
    safetyMargin: '0.25',
    downsideCashBreak: false,
    downsideMoic: '1.5',
    exitDelayed: false,
  });

  it('selects permanent default when risk is low', () => {
    const result = estimateLossRanges(baseInput());
    expect(result.permanentLoss.selectedRuleId).toBe('permanent_default');
    expect(result.permanentLoss.lower).toBe('0.05');
    expect(result.permanentLoss.upper).toBe('0.2');
  });

  it('selects permanent rule 5 when overall risk >= 0.33', () => {
    const result = estimateLossRanges({ ...baseInput(), overallResidualRisk: '0.4' });
    expect(result.permanentLoss.selectedRuleId).toBe('permanent_overall_risk_at_least_033');
    expect(result.permanentLoss.lower).toBe('0.15');
    expect(result.permanentLoss.upper).toBe('0.35');
  });

  it('selects permanent rule 4 when overall risk >= 0.67', () => {
    const result = estimateLossRanges({ ...baseInput(), overallResidualRisk: '0.7' });
    expect(result.permanentLoss.selectedRuleId).toBe('permanent_overall_risk_at_least_067');
    expect(result.permanentLoss.lower).toBe('0.3');
    expect(result.permanentLoss.upper).toBe('0.6');
  });

  it('selects permanent rule 3 when cash breaks and moic < 1', () => {
    const result = estimateLossRanges({
      ...baseInput(),
      overallResidualRisk: '0.8',
      downsideCashBreak: true,
      downsideMoic: '0.5',
    });
    expect(result.permanentLoss.selectedRuleId).toBe('permanent_cash_break_and_moic_below_one');
    expect(result.permanentLoss.lower).toBe('0.4');
    expect(result.permanentLoss.upper).toBe('0.7');
  });

  it('selects permanent_rule 2 for open pause', () => {
    const result = estimateLossRanges({
      ...baseInput(),
      fatalOutcome: 'pause',
      overallResidualRisk: '0.9',
      downsideCashBreak: true,
      downsideMoic: '0.3',
    });
    expect(result.permanentLoss.selectedRuleId).toBe('permanent_open_pause');
    expect(result.permanentLoss.lower).toBe('0.5');
    expect(result.permanentLoss.upper).toBe('0.8');
  });

  it('selects permanent_rule 1 for open reject', () => {
    const result = estimateLossRanges({
      ...baseInput(),
      fatalOutcome: 'reject',
      notCurableByClause: true,
    });
    expect(result.permanentLoss.selectedRuleId).toBe('permanent_open_reject');
    expect(result.permanentLoss.lower).toBe('0.75');
    expect(result.permanentLoss.upper).toBe('1');
  });

  it('records all triggered permanent rules', () => {
    const result = estimateLossRanges({
      ...baseInput(),
      overallResidualRisk: '0.7',
      downsideCashBreak: true,
      downsideMoic: '0.4',
    });
    expect(result.permanentLoss.triggeredRuleIds).toContain('permanent_cash_break_and_moic_below_one');
    expect(result.permanentLoss.triggeredRuleIds).toContain('permanent_overall_risk_at_least_067');
    expect(result.permanentLoss.triggeredRuleIds).toContain('permanent_overall_risk_at_least_033');
    expect(result.permanentLoss.triggeredRuleIds).toContain('permanent_default');
  });

  it('selects temporary default when conditions are clean', () => {
    const result = estimateLossRanges(baseInput());
    expect(result.temporaryDrawdown.selectedRuleId).toBe('temporary_default');
    expect(result.temporaryDrawdown.lower).toBe('0.05');
    expect(result.temporaryDrawdown.upper).toBe('0.25');
  });

  it('selects temporary rule 4 when overall risk >= 0.33', () => {
    const result = estimateLossRanges({ ...baseInput(), overallResidualRisk: '0.4' });
    expect(result.temporaryDrawdown.selectedRuleId).toBe('temporary_overall_risk_at_least_033');
  });

  it('selects temporary rule 3 when margin < 0.20', () => {
    const result = estimateLossRanges({ ...baseInput(), safetyMargin: '0.15', overallResidualRisk: '0.4' });
    expect(result.temporaryDrawdown.selectedRuleId).toBe('temporary_margin_below_020');
    expect(result.temporaryDrawdown.lower).toBe('0.25');
    expect(result.temporaryDrawdown.upper).toBe('0.5');
  });

  it('selects temporary rule 2 when downside moic < 1', () => {
    const result = estimateLossRanges({
      ...baseInput(),
      safetyMargin: '0.1',
      downsideMoic: '0.8',
      overallResidualRisk: '0.5',
    });
    expect(result.temporaryDrawdown.selectedRuleId).toBe('temporary_downside_moic_below_one');
    expect(result.temporaryDrawdown.lower).toBe('0.35');
    expect(result.temporaryDrawdown.upper).toBe('0.65');
  });

  it('selects temporary rule 1 when exit delayed and margin < 0.15', () => {
    const result = estimateLossRanges({
      ...baseInput(),
      exitDelayed: true,
      safetyMargin: '0.1',
      downsideMoic: '0.5',
      overallResidualRisk: '0.5',
    });
    expect(result.temporaryDrawdown.selectedRuleId).toBe('temporary_exit_delay_and_margin_below_015');
    expect(result.temporaryDrawdown.lower).toBe('0.45');
    expect(result.temporaryDrawdown.upper).toBe('0.75');
  });

  it('requires investor confirmation for both ranges', () => {
    const result = estimateLossRanges(baseInput());
    expect(result.permanentLoss.requiresInvestorConfirmation).toBe(true);
    expect(result.temporaryDrawdown.requiresInvestorConfirmation).toBe(true);
  });

  it('handles missing overall risk gracefully', () => {
    const result = estimateLossRanges({
      ...baseInput(),
      overallResidualRisk: null as any,
    });
    // With null risk, only fatal flaw and default rules can fire
    expect(result.permanentLoss.selectedRuleId).toBe('permanent_default');
    expect(result.permanentLoss.missingInputs).toContain('overallResidualRisk');
  });
});
