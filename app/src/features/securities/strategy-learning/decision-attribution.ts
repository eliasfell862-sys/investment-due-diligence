import type { DecisionType, ReviewEvidence, ReviewFinding } from './types';

export interface AttributionInput {
  decisionType: DecisionType;
  reasons: string[];
  decisionPrice: number;
  closePrice: number;
  atr: number | null;
  rsi6: number | null;
  availableShares: number;
  existingReturnPct: number;
  nextDayReturnPct: number | null;
  dataQualityBlockingIssues: string[];
}

export interface DecisionAttribution {
  processQuality: 'good' | 'needs_improvement' | 'insufficient_evidence';
  resultQuality: 'positive' | 'negative' | 'pending_follow_up';
  evidence: ReviewEvidence[];
  positiveFindings: ReviewFinding[];
  negativeFindings: ReviewFinding[];
  confidence: number;
  attribution: Record<string, number>;
}

const finding = (id: string, title: string, description: string,
  evidence: ReviewEvidence[], confidence: number): ReviewFinding => ({
  id, title, description, evidenceKind: evidence[0]?.kind ?? 'model_judgment',
  evidence, confidence,
});

export function attributeVirtualTransaction(input: AttributionInput): DecisionAttribution {
  if (input.dataQualityBlockingIssues.length > 0) {
    const evidence: ReviewEvidence[] = [{
      kind: 'insufficient_evidence', label: '冻结数据不完整',
      value: input.dataQualityBlockingIssues.join('；'),
    }];
    return {
      processQuality: 'insufficient_evidence', resultQuality: 'pending_follow_up', evidence,
      positiveFindings: [], negativeFindings: [finding('blocking-data', '证据不足',
        '冻结数据存在阻断问题，本次不评价策略质量。', evidence, 0)],
      confidence: 0, attribution: {},
    };
  }

  const evidence: ReviewEvidence[] = [
    { kind: 'fact', label: '成交价格', value: input.decisionPrice },
    { kind: 'fact', label: '触发依据', value: input.reasons.join('、') || '未记录' },
  ];
  if (input.rsi6 !== null) evidence.push({ kind: 'calculation', label: 'RSI6', value: input.rsi6 });
  if (input.atr !== null) evidence.push({ kind: 'calculation', label: 'ATR距离',
    value: Math.round(Math.abs(input.closePrice - input.decisionPrice) / Math.max(input.atr, 0.0001) * 100) / 100 });

  const rationaleMatched = input.reasons.some(reason =>
    (reason.includes('RSI') && input.rsi6 !== null && input.rsi6 < 30)
    || reason.includes('MACD') || reason.includes('KDJ') || reason.includes('布林') || reason.includes('MA'));
  const processQuality = rationaleMatched ? 'good' : 'needs_improvement';
  const resultQuality = input.nextDayReturnPct === null
    ? 'pending_follow_up'
    : input.nextDayReturnPct >= 0 ? 'positive' : 'negative';
  const positiveFindings = processQuality === 'good'
    ? [finding('supported-process', '决策过程有依据', '交易理由与冻结技术指标一致。', evidence, 0.8)]
    : [];
  const negativeFindings = processQuality === 'needs_improvement'
    ? [finding('weak-rationale', '决策依据不足', '交易理由未被冻结指标充分支持。', evidence, 0.55)]
    : [];
  return {
    processQuality, resultQuality, evidence, positiveFindings, negativeFindings,
    confidence: rationaleMatched ? 0.8 : 0.55,
    attribution: { timing: rationaleMatched ? 1 : -1, execution: 0, market: 0, industry: 0 },
  };
}
