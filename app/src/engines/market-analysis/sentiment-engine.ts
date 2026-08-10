/**
 * 新闻情绪分析引擎 —— 基于东方财富公告标题的规则评分。
 *
 * 纯函数、离线可跑、不依赖 AI 密钥。词库基于 A 股真实公告披露语言构建（研究子代理
 * 产出），评分做了两项正确性处理：
 *  1. 最长匹配去重：命中"控股股东减持"时不再单独计"减持"，避免重复计权；
 *  2. 语境压制：如"解除质押"释放风险（压制"质押"利空并加分）、"终止/取消减持"
 *     意味利空解除（压制"减持"），否则极性会判反。
 */
import type { StockNewsItem } from '../../infrastructure/news/news-api';

export type SentimentLabel = 'bullish' | 'neutral' | 'bearish';

export interface SentimentLexicon {
  /** 利好关键词：[词, 权重]，权重 0~1 */
  bullish: ReadonlyArray<readonly [string, number]>;
  /** 利空关键词：[词, 权重]，权重 -1~0 */
  bearish: ReadonlyArray<readonly [string, number]>;
}

export interface MatchedKeyword {
  keyword: string;
  weight: number;
}

export interface NewsItemSentiment {
  item: StockNewsItem;
  /** -1（看空）~ 1（看多） */
  score: number;
  label: SentimentLabel;
  matchedKeywords: MatchedKeyword[];
}

export interface NewsSentimentResult {
  items: NewsItemSentiment[];
  /** -1~1，全部条目分数的均值 */
  overallScore: number;
  overallLabel: SentimentLabel;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
}

/** 默认 A 股公告情绪词库（东方财富公告标题语境，研究子代理产出）。 */
export const DEFAULT_LEXICON: SentimentLexicon = {
  bullish: [
    ['扭亏为盈', 0.85],
    ['业绩预增', 0.8],
    ['净利润大幅增长', 0.8],
    ['业绩预盈', 0.7],
    ['净利润同比增长', 0.6],
    ['回购注销', 0.6],
    ['控股股东增持', 0.6],
    ['中标', 0.6],
    ['资产注入', 0.6],
    ['重大资产重组', 0.55],
    ['签订重大合同', 0.55],
    ['业绩快报', 0.4],
    ['回购股份', 0.5],
    ['增持', 0.5],
    ['高送转', 0.5],
    ['并购重组', 0.5],
    ['发行股份购买资产', 0.5],
    ['要约收购', 0.5],
    ['每10股派发现金红利', 0.45],
    ['特别分红', 0.45],
    ['获得药品注册证书', 0.45],
    ['引入战略投资者', 0.45],
    ['战略合作', 0.4],
    ['权益分派', 0.4],
    ['新签订单', 0.4],
    ['获得批文', 0.35],
    ['增资扩股', 0.35],
    ['控制权变更', 0.35],
    ['股权转让', 0.3],
    ['产能扩张', 0.3],
    ['政府补助', 0.3],
  ],
  bearish: [
    ['退市风险警示', -0.9],
    ['终止上市', -0.9],
    ['破产清算', -0.85],
    ['立案告知书', -0.85],
    ['立案调查', -0.8],
    ['破产重整', -0.8],
    ['业绩预亏', -0.8],
    ['预计亏损', -0.75],
    ['质押平仓', -0.75],
    ['行政处罚', -0.7],
    ['业绩预减', -0.7],
    ['首亏', -0.7],
    ['债务逾期', -0.7],
    ['清仓式减持', -0.65],
    ['处罚决定', -0.6],
    ['股份被冻结', -0.6],
    ['控股股东减持', -0.55],
    ['违约', -0.55],
    ['诉讼', -0.45],
    ['减持', -0.45],
    ['警示函', -0.4],
    ['限售股解禁', -0.35],
    ['股权质押', -0.35],
    ['质押', -0.35],
    ['仲裁', -0.35],
    ['监管函', -0.3],
    ['问询函', -0.25],
    ['关注函', -0.2],
    ['延期', -0.2],
    ['对外担保', -0.2],
    ['更正公告', -0.1],
  ],
};

/**
 * 语境压制规则：标题需同时命中 trigger（任一）与 target 才生效。
 * 生效时压制所有含 target 的利空关键词，并按 add 加分。双条件避免"解除劳动合同"
 * 这类无 target 的标题被误加分，也覆盖"减持计划终止"等反语序。
 */
interface ContextSuppression {
  trigger: readonly string[];
  target: string;
  add?: number;
}

const CONTEXT_SUPPRESSIONS: ReadonlyArray<ContextSuppression> = [
  { trigger: ['解除'], target: '质押', add: 0.5 },   // 解除...质押 → 释放风险利好（须含"质押"）
  { trigger: ['终止', '取消', '停止', '提前结束'], target: '减持' }, // 减持被取消/终止 → 压制利空
];

/** 标题命中这些短语说明质押风险仍在/新增，不被"解除质押"加分吞掉。 */
const RE_PLEDGE_PHRASES = ['补充质押', '重新质押', '再次质押', '新增质押'];

/** 分数 → 情绪标签。阈值 ±0.15（两位小数容差，避免浮点误判）。 */
export function labelOf(score: number): SentimentLabel {
  const rounded = Math.round(score * 100) / 100;
  if (rounded > 0.15) return 'bullish';
  if (rounded < -0.15) return 'bearish';
  return 'neutral';
}

/** 对单条标题匹配关键词，做语境压制 + 最长匹配去重后返回得分与证据。 */
export function scoreTitle(title: string, lexicon: SentimentLexicon = DEFAULT_LEXICON): {
  score: number;
  matchedKeywords: MatchedKeyword[];
} {
  const safeTitle = title ?? '';
  let matched: MatchedKeyword[] = [];
  for (const [keyword, weight] of lexicon.bullish) {
    if (safeTitle.includes(keyword)) matched.push({ keyword, weight });
  }
  for (const [keyword, weight] of lexicon.bearish) {
    if (safeTitle.includes(keyword)) matched.push({ keyword, weight });
  }

  // 语境压制：命中 trigger + target 双条件 → 移除被压制的利空关键词，按 add 加分
  for (const rule of CONTEXT_SUPPRESSIONS) {
    const hasTrigger = rule.trigger.some(word => safeTitle.includes(word));
    if (!hasTrigger || !safeTitle.includes(rule.target)) continue;
    matched = matched.filter(m => !(m.weight < 0 && m.keyword.includes(rule.target)));
    if (rule.add) matched.push({ keyword: rule.target, weight: rule.add });
    // 解除质押的同时又补充/重新质押 → 补回一份质押利空，避免新风险被吞
    if (rule.target === '质押' && RE_PLEDGE_PHRASES.some(phrase => safeTitle.includes(phrase))) {
      matched.push({ keyword: '补充质押', weight: -0.35 });
    }
  }

  // 最长匹配去重：短词是长词子串且方向相同（同号权重）→ 只保留长词
  const deduped = matched.filter(m =>
    !matched.some(other =>
      other !== m
      && other.weight * m.weight >= 0
      && other.keyword.includes(m.keyword)
      && other.keyword.length > m.keyword.length,
    ),
  );

  const raw = deduped.reduce((sum, m) => sum + m.weight, 0);
  return { score: Math.max(-1, Math.min(1, raw)), matchedKeywords: deduped };
}

/**
 * 对一组公告新闻做情绪分析。
 * @param items 结构化新闻项（title 为评分输入）
 * @param lexicon 情绪词库，默认 DEFAULT_LEXICON
 */
export function analyzeNewsSentiment(
  items: StockNewsItem[],
  lexicon: SentimentLexicon = DEFAULT_LEXICON,
): NewsSentimentResult {
  const itemResults: NewsItemSentiment[] = items.map(item => {
    const { score, matchedKeywords } = scoreTitle(item.title, lexicon);
    return { item, score, label: labelOf(score), matchedKeywords };
  });

  const bullishCount = itemResults.filter(r => r.label === 'bullish').length;
  const bearishCount = itemResults.filter(r => r.label === 'bearish').length;
  const neutralCount = itemResults.filter(r => r.label === 'neutral').length;
  const overallScore = itemResults.length === 0
    ? 0
    : itemResults.reduce((sum, r) => sum + r.score, 0) / itemResults.length;

  return {
    items: itemResults,
    overallScore,
    overallLabel: labelOf(overallScore),
    bullishCount,
    bearishCount,
    neutralCount,
  };
}
