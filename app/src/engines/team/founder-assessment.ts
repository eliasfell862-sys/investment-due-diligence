/**
 * Founder Assessment Engine
 *
 * Structured evaluation of founding team for early-stage investment decisions.
 * VC investors bet on founders more than business models at the seed/Series A stage.
 *
 * Dimensions:
 * - Industry Experience (行业经验)
 * - Execution Track Record (执行履历)
 * - Leadership & Team Building (领导力)
 * - Integrity & Character (诚信品格)
 * - Technical/Domain Expertise (技术/领域专长)
 * - Resilience & Adaptability (韧性适应力)
 */

export type FounderDimension =
  | 'industry_experience'
  | 'execution_track'
  | 'leadership'
  | 'integrity'
  | 'domain_expertise'
  | 'resilience';

export interface FounderScore {
  readonly dimension: FounderDimension;
  readonly score: number; // 0-10
  readonly evidence: string; // specific examples/facts backing the score
}

export interface FounderInput {
  readonly name: string;
  readonly role: string;
  readonly age?: number;
  readonly yearsInIndustry: number;
  readonly priorExits: number;
  readonly priorCompaniesFounded: number;
  readonly education: string;
  readonly scores: readonly FounderScore[];
}

export interface FounderResult {
  readonly totalScore: number; // 0-60
  readonly normalizedScore: number; // 0-100
  readonly tier: 'exceptional' | 'strong' | 'adequate' | 'weak' | 'insufficient_data';
  readonly tierLabel: string;
  readonly strengths: readonly string[];
  readonly concerns: readonly string[];
  readonly redFlags: readonly string[];
  readonly investmentThesisSnippet: string;
}

export interface TeamAssessmentInput {
  readonly founders: readonly FounderInput[];
  readonly teamSize: number;
  readonly keyRolesFilled: number; // out of key roles needed
  readonly totalKeyRoles: number;
  readonly equitySplitNotes: string; // e.g. "evenly split 50/50" or "CEO 60%, CTO 40%"
}

export interface TeamAssessmentResult {
  readonly averageFounderScore: number;
  readonly founderResults: readonly FounderResult[];
  readonly teamCompleteness: number; // 0-100
  readonly teamRedFlags: readonly string[];
  readonly overallTier: 'strong_team' | 'adequate_team' | 'founder_dependent' | 'weak_team';
  readonly overallLabel: string;
  readonly recommendation: string;
}

// ── Labels ──

export const FOUNDER_DIMENSION_LABELS: Record<FounderDimension, string> = {
  industry_experience: '行业经验',
  execution_track: '执行履历',
  leadership: '领导力与团队',
  integrity: '诚信品格',
  domain_expertise: '技术/领域专长',
  resilience: '韧性与适应力',
};

export const FOUNDER_DIMENSION_PROMPTS: Record<FounderDimension, string> = {
  industry_experience: '在该行业从业年限？是否经历过完整周期？对产业链各环节的理解深度？',
  execution_track: '过去是否有成功交付/退出的项目？是否有可验证的业绩记录？',
  leadership: '能否吸引和留住优秀人才？团队流失率如何？是否有培养下属的案例？',
  integrity: '背景调查是否干净？过往商业伙伴评价如何？是否坦诚面对问题和失败？',
  domain_expertise: '在核心技术/业务领域是否具备深厚的专业知识？是行业公认的专家吗？',
  resilience: '面对逆境如何反应？是否有从失败中站起来的历史？心理韧性如何？',
};

// ── Scoring ──

export function assessFounder(input: FounderInput): FounderResult {
  const { scores } = input;

  const scoreMap = new Map<FounderDimension, FounderScore>();
  for (const s of scores) {
    scoreMap.set(s.dimension, s);
  }

  const allDimensions: FounderDimension[] = [
    'industry_experience', 'execution_track', 'leadership',
    'integrity', 'domain_expertise', 'resilience',
  ];

  const filledDimensions = allDimensions.filter(d => scoreMap.has(d));
  const totalScore = filledDimensions.reduce((sum, d) => sum + (scoreMap.get(d)?.score ?? 0), 0);
  const maxPossible = filledDimensions.length * 10;
  const normalizedScore = maxPossible > 0 ? Math.round((totalScore / maxPossible) * 100) : 0;

  // Tier classification
  let tier: FounderResult['tier'];
  let tierLabel: string;
  if (filledDimensions.length < 3) {
    tier = 'insufficient_data';
    tierLabel = '数据不足';
  } else if (normalizedScore >= 85) {
    tier = 'exceptional';
    tierLabel = '杰出';
  } else if (normalizedScore >= 70) {
    tier = 'strong';
    tierLabel = '优秀';
  } else if (normalizedScore >= 50) {
    tier = 'adequate';
    tierLabel = '合格';
  } else {
    tier = 'weak';
    tierLabel = '薄弱';
  }

  // Strengths and concerns
  const strengths: string[] = [];
  const concerns: string[] = [];
  const redFlags: string[] = [];

  for (const d of allDimensions) {
    const s = scoreMap.get(d);
    if (s && s.score >= 8) {
      strengths.push(`${FOUNDER_DIMENSION_LABELS[d]}：${s.score}/10 — ${s.evidence || '表现突出'}`);
    }
    if (s && s.score <= 4 && s.score > 0) {
      concerns.push(`${FOUNDER_DIMENSION_LABELS[d]}：${s.score}/10 — ${s.evidence || '需进一步了解'}`);
    }
  }

  // Red flags
  if (scoreMap.get('integrity') && scoreMap.get('integrity')!.score <= 3) {
    redFlags.push('⚠️ 诚信评分极低，建议进行背景调查');
  }
  if (scoreMap.get('execution_track') && scoreMap.get('execution_track')!.score <= 3 && input.priorExits === 0) {
    redFlags.push('⚠️ 无成功退出记录且执行评分低');
  }
  if (input.yearsInIndustry < 2 && scoreMap.get('industry_experience') && scoreMap.get('industry_experience')!.score <= 5) {
    redFlags.push('⚠️ 行业经验不足 2 年');
  }

  // Thesis snippet
  const thesisParts: string[] = [];
  thesisParts.push(`${input.name}（${input.role}）`);
  if (input.priorExits > 0) thesisParts.push(`${input.priorExits}次成功退出`);
  if (input.yearsInIndustry >= 5) thesisParts.push(`${input.yearsInIndustry}年行业经验`);
  if (strengths.length > 0) {
    thesisParts.push(`核心优势：${strengths.slice(0, 2).map(s => s.split('：')[0]).join('、')}`);
  }
  const investmentThesisSnippet = thesisParts.join('，') + '。';

  return {
    totalScore,
    normalizedScore,
    tier,
    tierLabel,
    strengths,
    concerns,
    redFlags,
    investmentThesisSnippet,
  };
}

export function assessTeam(input: TeamAssessmentInput): TeamAssessmentResult {
  const founderResults = input.founders.map(f => assessFounder(f));
  const validResults = founderResults.filter(r => r.tier !== 'insufficient_data');

  const averageFounderScore = validResults.length > 0
    ? Math.round(validResults.reduce((s, r) => s + r.normalizedScore, 0) / validResults.length)
    : 0;

  const teamCompleteness = input.totalKeyRoles > 0
    ? Math.round((input.keyRolesFilled / input.totalKeyRoles) * 100)
    : 0;

  const teamRedFlags: string[] = [];

  // Collect all founder red flags
  for (const fr of founderResults) {
    teamRedFlags.push(...fr.redFlags);
  }

  // Team-level checks
  if (input.founders.length === 1 && input.teamSize <= 3) {
    teamRedFlags.push('⚠️ 单创始人 + 小团队，关键人员风险极高');
  }
  if (input.teamSize < 5 && teamCompleteness < 50) {
    teamRedFlags.push('⚠️ 团队规模小且关键岗位空缺严重');
  }

  // Equity split checks
  const equityLower = input.equitySplitNotes.toLowerCase();
  if (equityLower.includes('50') && input.founders.length === 2) {
    teamRedFlags.push('⚠️ 50/50 股权结构可能在决策僵局时产生问题');
  }
  if (equityLower.includes('不均') || equityLower.includes('unfair') || equityLower.includes('dispute')) {
    teamRedFlags.push('⚠️ 股权分配存在争议');
  }

  // Overall
  let overallTier: TeamAssessmentResult['overallTier'];
  let overallLabel: string;
  if (averageFounderScore >= 80 && teamCompleteness >= 70 && teamRedFlags.length === 0) {
    overallTier = 'strong_team';
    overallLabel = '强团队';
  } else if (averageFounderScore >= 60 && teamCompleteness >= 50 && teamRedFlags.length <= 1) {
    overallTier = 'adequate_team';
    overallLabel = '团队合格';
  } else if (averageFounderScore >= 60 && teamCompleteness < 50) {
    overallTier = 'founder_dependent';
    overallLabel = '依赖创始人';
  } else {
    overallTier = 'weak_team';
    overallLabel = '团队薄弱';
  }

  const recommendations: string[] = [];
  if (overallTier === 'strong_team') {
    recommendations.push('团队是投资的加分项，可作为领投方重点推进');
  } else if (overallTier === 'adequate_team') {
    recommendations.push('团队基本合格，建议关注投后的人才补充计划');
  } else if (overallTier === 'founder_dependent') {
    recommendations.push('创始人有能力但团队不完整，投资条件应包括关键岗位招聘里程碑');
  } else {
    recommendations.push('团队是投资的顾虑点，建议要求补充核心成员后再推进，或降低估值');
  }

  if (teamCompleteness < 60) {
    recommendations.push(`关键岗位空缺率 ${100 - teamCompleteness}%，建议投前明确招聘计划`);
  }

  return {
    averageFounderScore,
    founderResults,
    teamCompleteness,
    teamRedFlags,
    overallTier,
    overallLabel,
    recommendation: recommendations.join('；'),
  };
}
