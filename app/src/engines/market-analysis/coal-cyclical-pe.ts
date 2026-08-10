export type CoalCyclicalPeStatus = 'not_applicable' | 'unassessed' | 'evaluated';
export type CoalCyclicalPeSignal = 'none' | 'cycle_bottom_candidate' | 'peak_profit_risk' | 'neutral';

export interface CoalCyclicalPeAssessment {
  status: CoalCyclicalPeStatus;
  signal: CoalCyclicalPeSignal;
  scoreAdjustment: number;
  evidence: string[];
}

interface CoalPeBaseline {
  name: string;
  sampleCount: number;
  p30: number;
  p35: number;
  p65: number;
  p70: number;
}

const BASELINE_AS_OF = '2026-08-04';

const COAL_PE_BASELINES: Readonly<Record<string, CoalPeBaseline>> = {
  '601088': { name: '中国神华', sampleCount: 731, p30: 8.82, p35: 9.06, p65: 12.58, p70: 13.30 },
  '601225': { name: '陕西煤业', sampleCount: 678, p30: 7.30, p35: 7.54, p65: 8.63, p70: 9.07 },
  '600188': { name: '兖矿能源', sampleCount: 731, p30: 6.69, p35: 7.49, p65: 9.84, p70: 10.64 },
  '601898': { name: '中煤能源', sampleCount: 714, p30: 8.82, p35: 9.45, p65: 13.72, p70: 15.06 },
  '600348': { name: '华阳股份', sampleCount: 686, p30: 6.85, p35: 7.35, p65: 10.28, p70: 11.26 },
  '601699': { name: '潞安环能', sampleCount: 731, p30: 7.53, p35: 7.88, p65: 11.63, p70: 12.77 },
  '000983': { name: '山西焦煤', sampleCount: 731, p30: 9.65, p35: 10.08, p65: 14.21, p70: 15.25 },
  '600997': { name: '开滦股份', sampleCount: 688, p30: 6.90, p35: 7.86, p65: 13.47, p70: 14.12 },
  '601666': { name: '平煤股份', sampleCount: 678, p30: 8.38, p35: 8.62, p65: 10.23, p70: 10.49 },
  '600395': { name: '盘江股份', sampleCount: 666, p30: 9.88, p35: 10.25, p65: 15.16, p70: 16.59 },
};

export function assessCoalCyclicalPe(input: { code: string; pe: number }): CoalCyclicalPeAssessment {
  const baseline = COAL_PE_BASELINES[input.code];
  if (!baseline) {
    return { status: 'not_applicable', signal: 'none', scoreAdjustment: 0, evidence: [] };
  }
  if (!Number.isFinite(input.pe) || input.pe <= 0) {
    return {
      status: 'unassessed',
      signal: 'none',
      scoreAdjustment: 0,
      evidence: [`煤炭周期PE未评估：${baseline.name}当前PE不可用`],
    };
  }

  const prefix = `煤炭周期PE：当前${input.pe.toFixed(2)}倍`;
  const source = `历史基准${baseline.sampleCount}个观测，更新至${BASELINE_AS_OF}`;
  if (input.pe <= baseline.p30) {
    return {
      status: 'evaluated',
      signal: 'peak_profit_risk',
      scoreAdjustment: -8,
      evidence: [`${prefix}低于30%分位${baseline.p30.toFixed(2)}倍，警惕峰值利润造成的低PE陷阱`, source],
    };
  }
  if (input.pe <= baseline.p35) {
    return {
      status: 'evaluated',
      signal: 'peak_profit_risk',
      scoreAdjustment: -5,
      evidence: [`${prefix}接近历史低位，需核查煤价、单位利润和新增产能`, source],
    };
  }
  if (input.pe >= baseline.p70) {
    return {
      status: 'evaluated',
      signal: 'cycle_bottom_candidate',
      scoreAdjustment: 6,
      evidence: [`${prefix}高于70%分位${baseline.p70.toFixed(2)}倍，属于周期底部候选而非直接买入结论`, source],
    };
  }
  if (input.pe >= baseline.p65) {
    return {
      status: 'evaluated',
      signal: 'cycle_bottom_candidate',
      scoreAdjustment: 3,
      evidence: [`${prefix}进入历史偏高区域，等待商品价格与盈利拐点确认`, source],
    };
  }
  return {
    status: 'evaluated',
    signal: 'neutral',
    scoreAdjustment: 0,
    evidence: [`${prefix}位于历史中性区间，反向PE不调整原模型`, source],
  };
}
