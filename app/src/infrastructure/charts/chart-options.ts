import type { EChartsOption } from 'echarts';

const BASE_STYLE: Partial<EChartsOption> = {
  textStyle: { fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif' },
};

export function revenueWaterfall(labels: string[], values: number[], title = 'Revenue Bridge'): EChartsOption {
  return {
    ...BASE_STYLE,
    title: { text: title, left: 'center', textStyle: { fontSize: 16 } },
    tooltip: { trigger: 'axis' },
    grid: { top: 60, right: 20, bottom: 40, left: 80 },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: 'Amount' },
    series: [{ type: 'bar', data: values, itemStyle: { color: '#16766f' } }],
  };
}

export function marginTrend(periods: string[], gross: number[], ebitda: number[], net: number[]): EChartsOption {
  return {
    ...BASE_STYLE,
    title: { text: 'Margin Trends', left: 'center', textStyle: { fontSize: 16 } },
    tooltip: { trigger: 'axis' },
    legend: { data: ['Gross Margin', 'EBITDA Margin', 'Net Margin'], bottom: 0 },
    grid: { top: 60, right: 20, bottom: 50, left: 80 },
    xAxis: { type: 'category', data: periods },
    yAxis: { type: 'value', name: '%', axisLabel: { formatter: '{value}%' } },
    series: [
      { name: 'Gross Margin', type: 'line', data: gross, smooth: true, lineStyle: { color: '#16766f' } },
      { name: 'EBITDA Margin', type: 'line', data: ebitda, smooth: true, lineStyle: { color: '#0a84ff' } },
      { name: 'Net Margin', type: 'line', data: net, smooth: true, lineStyle: { color: '#ff9f0a' } },
    ],
  };
}

export function valuationFootballField(methods: string[], lows: number[], highs: number[], mids: number[]): EChartsOption {
  return {
    ...BASE_STYLE,
    title: { text: 'Valuation Football Field', left: 'center', textStyle: { fontSize: 16 } },
    tooltip: { trigger: 'item' },
    grid: { top: 60, right: 40, bottom: 40, left: 120 },
    xAxis: { type: 'value', name: 'Enterprise Value' },
    yAxis: { type: 'category', data: methods },
    series: [
      { type: 'bar', data: highs.map((h, i) => h - lows[i]!), stack: 'x', itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } } },
      { type: 'bar', data: lows, stack: 'x', itemStyle: { color: 'transparent' }, barGap: '-100%' },
      { type: 'bar', data: highs.map((h, i) => h - mids[i]!), stack: 'x', itemStyle: { color: '#16766f' } },
      { type: 'bar', data: mids.map((m, i) => m - lows[i]!), stack: 'x', itemStyle: { color: '#0a84ff' } },
    ],
  };
}

export function riskHeatmap(
  categories: string[], risks: { category: string; riskId: string; value: number }[],
): EChartsOption {
  const catMap = new Map(categories.map((c, i) => [c, i]));
  return {
    ...BASE_STYLE,
    title: { text: 'Risk Matrix', left: 'center', textStyle: { fontSize: 16 } },
    tooltip: {},
    grid: { top: 60, right: 20, bottom: 40, left: 100 },
    xAxis: { type: 'category', data: ['Residual Risk'], axisLabel: { rotate: 0 } },
    yAxis: { type: 'category', data: categories },
    visualMap: { min: 0, max: 1, inRange: { color: ['#dff3e6', '#fff0c2', '#ffe0df'] } },
    series: [{
      type: 'heatmap', data: risks.map((r) => [0, catMap.get(r.category) ?? 0, r.value]),
      label: { show: true, formatter: (p: any) => p.value[2].toFixed(2) },
    }],
  };
}

export function returnsSensitivity(
  irrMatrix: number[][], exitYears: string[], entryValRows: string[],
): EChartsOption {
  return {
    ...BASE_STYLE,
    title: { text: 'IRR Sensitivity', left: 'center', textStyle: { fontSize: 16 } },
    tooltip: {},
    grid: { top: 60, right: 20, bottom: 40, left: 80 },
    xAxis: { type: 'category', data: exitYears, name: 'Exit Year' },
    yAxis: { type: 'category', data: entryValRows, name: 'Entry Valuation' },
    visualMap: { min: Math.min(...irrMatrix.flat()), max: Math.max(...irrMatrix.flat()), inRange: { color: ['#ffe0df', '#fff0c2', '#dff3e6'] } },
    series: [{
      type: 'heatmap',
      data: irrMatrix.flatMap((row, i) => row.map((val, j) => [j, i, val])),
      label: { show: true, formatter: (p: any) => `${(p.value[2] * 100).toFixed(0)}%` },
    }],
  };
}

export function competitorRadar(
  indicators: { name: string; max: number }[],
  data: { name: string; value: number[] }[],
): EChartsOption {
  return {
    ...BASE_STYLE,
    title: { text: 'Competitor Radar', left: 'center', textStyle: { fontSize: 16 } },
    tooltip: {},
    legend: { data: data.map((d) => d.name), bottom: 0 },
    radar: { indicator: indicators, center: ['50%', '55%'], radius: '65%' },
    series: [{ type: 'radar', data: data.map((d) => ({ ...d })) }],
  };
}
