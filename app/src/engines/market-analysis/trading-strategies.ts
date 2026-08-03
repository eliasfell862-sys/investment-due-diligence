/**
 * Trading Strategies — TypeScript port of InStock's 10 strategy library.
 * Original Python: https://github.com/InStock/instock/core/strategy/
 *
 * All strategies operate on pre-computed K-line data with indicators already calculated.
 */

export interface StrategySignal {
  id: string;
  name: string;
  type: 'buy' | 'sell' | 'neutral';
  strength: '强' | '中' | '弱';
  description: string;
  conditions: string[];
}

// ── Helper: Volume MA ──
function volMA(klines: any[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) { result.push(0); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += klines[j].volume;
    result.push(sum / period);
  }
  return result;
}

// ── Helper: MA ──
function calcMA(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(0); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result.push(sum / period);
  }
  return result;
}

// ── Helper: check volume surge ──
function isVolumeSurge(klines: any[], threshold = 60): boolean {
  if (klines.length < threshold + 1) return false;
  const last = klines[klines.length - 1];
  const lastClose = last.close;
  const lastVol = last.volume;
  const amount = lastClose * lastVol;
  if (amount < 200000000) return false; // 成交额 < 2亿
  const volMA5 = volMA(klines.slice(0, -1), 5);
  const meanVol = volMA5[volMA5.length - 1];
  if (meanVol <= 0) return false;
  return lastVol / meanVol >= 2;
}

// ═══════════════════════════════════════════════════════════════
// 1. 平台突破 Breakthrough Platform
// ═══════════════════════════════════════════════════════════════
function checkBreakthroughPlatform(klines: any[]): StrategySignal | null {
  if (klines.length < 60) return null;
  const close = klines.map(k => k.close);
  const open = klines.map(k => k.open);
  const ma60 = calcMA(close, 60);
  const tail = klines.slice(-60);
  const tailMA60 = ma60.slice(-60);

  // Find first day where close >= MA60 > open
  let breakthroughIdx = -1;
  for (let i = 0; i < tail.length; i++) {
    const c = close[close.length - 60 + i];
    const o = open[open.length - 60 + i];
    const m = tailMA60[i];
    if (m > 0 && o < m && m <= c) {
      if (isVolumeSurge(klines.slice(0, klines.length - 60 + i + 1), 60)) {
        breakthroughIdx = klines.length - 60 + i;
        break;
      }
    }
  }
  if (breakthroughIdx < 0) return null;

  // Check: before breakthrough, all closes within -5% to +20% of MA60
  const front = klines.slice(0, breakthroughIdx);
  const frontMA60 = ma60.slice(0, breakthroughIdx);
  for (let i = front.length - 1; i >= Math.max(0, front.length - 60); i--) {
    if (frontMA60[i] <= 0) continue;
    const deviation = (frontMA60[i] - front[i].close) / frontMA60[i];
    if (deviation < -0.05 || deviation > 0.2) return null;
  }

  return {
    id: 'breakthrough_platform',
    name: '平台突破',
    type: 'buy',
    strength: '强',
    description: '收盘价突破60日均线，且前期价格在-5%~+20%区间内整理，放量突破',
    conditions: ['收盘≥MA60>开盘', '前期横盘整理', '放量上涨(量>2倍5日均量)'],
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. 高紧旗形 High Tight Flag
// ═══════════════════════════════════════════════════════════════
function checkHighTightFlag(klines: any[]): StrategySignal | null {
  if (klines.length < 24) return null;
  const tail24 = klines.slice(-24);
  const head14 = tail24.slice(0, 14);
  const lowMin = Math.min(...head14.map(k => k.low));
  const ratioIncrease = tail24[tail24.length - 1].high / lowMin;
  if (ratioIncrease < 1.9) return null;

  // Two consecutive days with >= 9.5% gain
  let prevPct = 0;
  for (const k of head14) {
    const pct = k.changePct || ((k.close - k.open) / k.open * 100);
    if (pct >= 9.5) {
      if (prevPct >= 9.5) return {
        id: 'high_tight_flag',
        name: '高紧旗形',
        type: 'buy',
        strength: '强',
        description: '涨停后14日内最低价涨幅≥1.9倍，连续两日涨幅≥9.5%，典型旗形突破形态',
        conditions: ['24日内出现连续两日涨幅≥9.5%', '14日最低价到今日最高价≥1.9倍'],
      };
      prevPct = pct;
    } else { prevPct = 0; }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 3. 海龟交易 Turtle Trade
// ═══════════════════════════════════════════════════════════════
function checkTurtleTrade(klines: any[]): StrategySignal | null {
  if (klines.length < 60) return null;
  const tail60 = klines.slice(-60);
  const maxClose = Math.max(...tail60.map(k => k.close));
  const lastClose = tail60[tail60.length - 1].close;
  if (lastClose >= maxClose) {
    return {
      id: 'turtle_trade',
      name: '海龟突破',
      type: 'buy',
      strength: '中',
      description: '收盘价创60日新高，海龟交易法则入场信号',
      conditions: ['收盘价≥60日最高收盘价'],
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 4. 放量跌停 Climax Limit Down（反向信号→卖出）
// ═══════════════════════════════════════════════════════════════
function checkClimaxLimitDown(klines: any[]): StrategySignal | null {
  if (klines.length < 61) return null;
  const last = klines[klines.length - 1];
  const pct = last.changePct || ((last.close - last.open) / last.open * 100);
  if (pct > -9.5) return null;

  const amount = last.close * last.volume;
  if (amount < 200000000) return null; // < 2亿

  const volMA5 = volMA(klines.slice(0, -1), 5);
  const meanVol = volMA5[volMA5.length - 1];
  if (meanVol <= 0) return null;
  const volRatio = last.volume / meanVol;
  if (volRatio >= 4) {
    return {
      id: 'climax_limitdown',
      name: '放量跌停',
      type: 'sell',
      strength: '强',
      description: '跌超9.5%且成交量≥5日均量4倍，恐慌性抛售信号',
      conditions: ['跌幅>9.5%', '成交额≥2亿', '量比≥4倍5日均量'],
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 5. 持续上涨 Keep Increasing (MA30 多头排列)
// ═══════════════════════════════════════════════════════════════
function checkKeepIncreasing(klines: any[]): StrategySignal | null {
  if (klines.length < 30) return null;
  const close = klines.map(k => k.close);
  const ma30 = calcMA(close, 30);
  const tail30 = ma30.slice(-30);
  if (tail30[0] <= 0) return null;

  const step1 = Math.round(30 / 3);  // 10
  const step2 = Math.round(30 * 2 / 3); // 20

  if (tail30[0] < tail30[step1] && tail30[step1] < tail30[step2] &&
      tail30[step2] < tail30[29] && tail30[29] > 1.2 * tail30[0]) {
    return {
      id: 'keep_increasing',
      name: '均线多头',
      type: 'buy',
      strength: '中',
      description: 'MA30持续上行，30日内均线阶梯式抬升且累计涨幅>20%',
      conditions: ['MA30(今日)>MA30(10日前)>MA30(20日前)>MA30(30日前)', 'MA30累计涨幅>20%'],
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 6. 低ATR成长 Low ATR Growth
// ═══════════════════════════════════════════════════════════════
function checkLowATR(klines: any[]): StrategySignal | null {
  if (klines.length < 250) return null;
  const tail10 = klines.slice(-10);
  const highs = tail10.map(k => k.close);
  const highest = Math.max(...highs);
  const lowest = Math.min(...highs);
  const ratio = (highest - lowest) / lowest;

  // Calculate ATR (Average True Range scaled)
  let totalChange = 0;
  for (const k of tail10) {
    const pct = Math.abs(k.changePct || ((k.close - k.open) / k.open * 100));
    totalChange += pct;
  }
  const atr = totalChange / tail10.length;
  if (atr > 10) return null;

  if (ratio > 0.1) {
    return {
      id: 'low_atr',
      name: '低波成长',
      type: 'buy',
      strength: '弱',
      description: '10日内振幅>10%但平均波动<10%，低波动稳步上行',
      conditions: ['上市≥250日', '10日ATR<10%', '10日振幅>10%'],
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 7. 无大幅回撤 Low Backtrace
// ═══════════════════════════════════════════════════════════════
function checkLowBacktrace(klines: any[]): StrategySignal | null {
  if (klines.length < 60) return null;
  const tail60 = klines.slice(-60);
  const ratioIncrease = (tail60[59].close - tail60[0].close) / tail60[0].close;
  if (ratioIncrease < 0.6) return null;

  let prevPct = 100;
  let prevOpen = -1e6;
  for (const k of tail60) {
    const pct = k.changePct || ((k.close - k.open) / k.open * 100);
    const openToClose = (k.close - k.open) / k.open * 100;
    // 单日跌幅>7%
    if (pct < -7) return null;
    // 高开低走 >7%
    if (openToClose < -7) return null;
    // 两日累计跌 >10%
    if (prevPct + pct < -10) return null;
    // 两日高开低走累计 >10%
    if ((k.close - prevOpen) / prevOpen * 100 < -10) return null;
    prevPct = pct;
    prevOpen = k.open;
  }
  return {
    id: 'low_backtrace',
    name: '稳步上行',
    type: 'buy',
    strength: '中',
    description: '60日涨幅≥60%且无单日大跌>7%，无连续大跌>10%，趋势质量高',
    conditions: ['60日涨幅≥60%', '无单日跌幅>7%', '无连续两日跌幅>10%'],
  };
}

// ═══════════════════════════════════════════════════════════════
// 8. 停车坪 Parking Apron
// ═══════════════════════════════════════════════════════════════
function checkParkingApron(klines: any[]): StrategySignal | null {
  if (klines.length < 15) return null;
  const tail15 = klines.slice(-15);

  // Need at least one day with >9.5% gain (limit-up) that was a breakout
  for (let i = 0; i < tail15.length; i++) {
    const k = tail15[i];
    const pct = k.changePct || ((k.close - k.open) / k.open * 100);
    if (pct <= 9.5) continue;

    // Check turtle breakout on that day
    const upToIndex = klines.length - 15 + i + 1;
    const upToHere = klines.slice(0, upToIndex);
    if (upToHere.length < 60) continue;
    const prev60 = upToHere.slice(-60);
    const maxClose = Math.max(...prev60.map(x => x.close));
    if (k.close < maxClose) continue;

    // Next 3 days: consolidation above limit-up price
    const after = tail15.slice(i + 1, i + 4);
    if (after.length < 3) continue;

    const limitPrice = k.close;
    // Day 1: high open, close up, within 3% of open
    const d1 = after[0];
    if (!(d1.close > limitPrice && d1.open > limitPrice &&
          d1.close / d1.open > 0.97 && d1.close / d1.open < 1.03)) continue;

    // Day 2-3: same conditions, pct within ±5%
    const d23 = after.slice(1, 3);
    let ok = true;
    for (const d of d23) {
      if (!(d.close / d.open > 0.97 && d.close / d.open < 1.03 &&
            Math.abs(d.changePct || 0) < 5 && d.close > limitPrice && d.open > limitPrice)) {
        ok = false; break;
      }
    }
    if (!ok) continue;

    return {
      id: 'parking_apron',
      name: '停车坪',
      type: 'buy',
      strength: '强',
      description: '涨停突破60日高点后，连续3日在涨停价上方窄幅整理(±3%)，蓄力再突破',
      conditions: ['涨停日创60日新高', '涨停后3日收盘>涨停价', '振幅<3%', '涨跌幅±5%内'],
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 9. 回踩年线 Backtrace MA250
// ═══════════════════════════════════════════════════════════════
function checkBacktraceMA250(klines: any[]): StrategySignal | null {
  if (klines.length < 250) return null;
  const close = klines.map(k => k.close);
  const volume = klines.map(k => k.volume);
  const ma250 = calcMA(close, 250);
  const tail60 = klines.slice(-60);
  const tailMA250 = ma250.slice(-60);
  const tailClose = close.slice(-60);
  const tailVol = volume.slice(-60);

  // Find highest close in last 60
  let highestIdx = 0, highestClose = 0, highestVol = 0;
  let lowestClose = Infinity, lowestVol = 0;
  for (let i = 0; i < tail60.length; i++) {
    if (tailClose[i] > highestClose) { highestClose = tailClose[i]; highestVol = tailVol[i]; highestIdx = i; }
    if (tailClose[i] < lowestClose) { lowestClose = tailClose[i]; lowestVol = tailVol[i]; lowestIdx = i; }
  }
  if (lowestVol === 0 || highestVol === 0) return null;

  // Before highest: must break through MA250 from below
  const front = tail60.slice(0, highestIdx);
  const frontMA = tailMA250.slice(0, highestIdx);
  if (front.length < 2) return null;
  if (!(front[0].valueOf() < frontMA[0] && front[front.length - 1] > frontMA[frontMA.length - 1])) return null;

  // After highest: must stay above MA250
  const after = tail60.slice(highestIdx);
  const afterMA = tailMA250.slice(highestIdx);
  let recentLowIdx = highestIdx;
  let recentLowClose = Infinity, recentLowVol = 0;
  for (let i = 0; i < after.length; i++) {
    if (after[i] < afterMA[i]) return null;
    if (after[i] < recentLowClose) {
      recentLowClose = after[i];
      recentLowVol = tailVol[highestIdx + i];
      recentLowIdx = highestIdx + i;
    }
  }

  const dateDiff = recentLowIdx - highestIdx;
  if (dateDiff < 10 || dateDiff > 50) return null;

  const volRatio = highestVol / recentLowVol;
  const backRatio = recentLowClose / highestClose;
  if (volRatio > 2 && backRatio < 0.8) {
    return {
      id: 'backtrace_ma250',
      name: '回踩年线',
      type: 'buy',
      strength: '强',
      description: '股价突破年线后回调至年线附近，缩量回踩确认支撑，经典买点',
      conditions: ['前半段从年线下突破到年线上', '后半段始终在年线上方', '回踩缩量(量比>2)', '回踩幅度>20%', '距高点10-50日'],
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 10. 放量上涨 Volume Surge（辅助信号）
// ═══════════════════════════════════════════════════════════════
function checkVolumeSurge(klines: any[]): StrategySignal | null {
  if (klines.length < 61) return null;
  const last = klines[klines.length - 1];
  const pct = last.changePct || ((last.close - last.open) / last.open * 100);
  if (pct < 2 || last.close < last.open) return null;

  if (isVolumeSurge(klines, 60)) {
    return {
      id: 'volume_surge',
      name: '放量上涨',
      type: 'buy',
      strength: '中',
      description: '涨幅>2%且成交量≥5日均量2倍，成交额≥2亿，资金入场信号',
      conditions: ['涨幅>2%', '成交额≥2亿', '量比≥2倍5日均量'],
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Scanner: run all strategies
// ═══════════════════════════════════════════════════════════════

const STRATEGIES = [
  checkBreakthroughPlatform,
  checkHighTightFlag,
  checkTurtleTrade,
  checkClimaxLimitDown,
  checkKeepIncreasing,
  checkLowATR,
  checkLowBacktrace,
  checkParkingApron,
  checkBacktraceMA250,
  checkVolumeSurge,
];

export function scanStrategies(klines: any[]): StrategySignal[] {
  if (klines.length < 15) return [];
  const results: StrategySignal[] = [];
  for (const fn of STRATEGIES) {
    try {
      const signal = fn(klines);
      if (signal) results.push(signal);
    } catch { /* skip */ }
  }
  return results;
}
