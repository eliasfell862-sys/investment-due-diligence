/** SVG Waterfall chart — shows value build-up step by step */
import React from 'react';

export interface WaterfallStep {
  label: string;
  value: number;
  isTotal?: boolean; // total bars have different styling
}

interface Props {
  steps: readonly WaterfallStep[];
  title?: string;
  valueFormatter?: (v: number) => string;
  height?: number;
}

export const WaterfallChart: React.FC<Props> = ({
  steps, title, valueFormatter = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`, height = 300,
}) => {
  if (steps.length === 0) return null;

  const W = Math.max(400, steps.length * 90 + 80);
  const H = height;
  const pad = { top: 40, right: 30, bottom: 60, left: 60 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Calculate running total for bar positioning
  let runningTotal = 0;
  const barData = steps.map((s, i) => {
    if (s.isTotal || i === steps.length - 1) {
      // Total bar: from 0 to final value
      const start = 0;
      const end = s.value;
      runningTotal = s.value;
      return { ...s, start, end, isTotal: true };
    }
    const start = runningTotal;
    runningTotal += s.value;
    return { ...s, start, end: runningTotal, isTotal: false };
  });

  // Find value range
  const allValues = barData.flatMap(b => [b.start, b.end, 0]);
  const yMin = Math.min(...allValues) * 1.1;
  const yMax = Math.max(...allValues) * 1.15;
  const yRange = yMax - yMin;

  const toY = (v: number) => pad.top + plotH - ((v - yMin) / yRange) * plotH;

  const barW = Math.min(50, (plotW / steps.length) * 0.6);
  const gap = plotW / steps.length;

  // Grid
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + yRange * i / 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',maxWidth:W,background:'#0d1a1a',borderRadius:8}}>
      {title && <text x={W/2} y={22} textAnchor="middle" fill="#8ba8a8" fontSize={13} fontWeight="bold">{title}</text>}

      {/* Grid */}
      {yTicks.map((y, i) => (
        <g key={`g${i}`}>
          <line x1={pad.left} y1={toY(y)} x2={W-pad.right} y2={toY(y)} stroke="#1a3a3a" strokeWidth={0.5} />
          <text x={pad.left-6} y={toY(y)+4} textAnchor="end" fill="#5a7a7a" fontSize={9}>{valueFormatter(y)}</text>
        </g>
      ))}

      {/* Zero line */}
      <line x1={pad.left} y1={toY(0)} x2={W-pad.right} y2={toY(0)} stroke="#4a6a6a" strokeWidth={1} />

      {/* Bars */}
      {barData.map((b, i) => {
        const x = pad.left + i * gap + (gap - barW) / 2;
        const y1 = toY(Math.max(b.start, b.end));
        const y2 = toY(Math.min(b.start, b.end));
        const h = y2 - y1;

        const isPositive = b.value >= 0;
        const color = b.isTotal ? '#70b8b0' : isPositive ? '#4a9a8a' : '#c06050';

        return (
          <g key={i}>
            {/* Connector */}
            {i > 0 && !b.isTotal && (
              <line
                x1={pad.left + (i-1) * gap + (gap - barW) / 2 + barW}
                y1={toY(barData[i-1].end)}
                x2={x}
                y2={toY(b.start)}
                stroke="#5a7a7a" strokeWidth={1} strokeDasharray="3,2"
              />
            )}
            {/* Bar */}
            <rect x={x} y={y1} width={barW} height={Math.max(1, h)} rx={3}
              fill={color} opacity={b.isTotal ? 0.9 : 0.7}
              stroke={b.isTotal ? '#70b8b0' : 'none'} strokeWidth={b.isTotal ? 1.5 : 0}
            />
            {/* Value label */}
            <text x={x + barW/2} y={y1 - 6} textAnchor="middle" fill={color} fontSize={10} fontWeight="bold">
              {valueFormatter(b.value)}
            </text>
            {/* X label */}
            <text x={x + barW/2} y={H - pad.bottom + 16} textAnchor="middle" fill="#8ba8a8" fontSize={9}
              transform={`rotate(-25,${x + barW/2},${H - pad.bottom + 16})`}>
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
