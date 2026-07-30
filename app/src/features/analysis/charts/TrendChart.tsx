/** SVG Multi-line trend chart for financial time series */
import React from 'react';

export interface TrendLine {
  label: string;
  data: readonly number[];
  color: string;
  dashed?: boolean;
}

interface Props {
  lines: readonly TrendLine[];
  xLabels: readonly string[];
  title?: string;
  height?: number;
  valueFormatter?: (v: number) => string;
}

export const TrendChart: React.FC<Props> = ({
  lines, xLabels, title, height = 280, valueFormatter: _fmt = (v) => v.toFixed(0),
}) => {
  if (lines.length === 0 || xLabels.length === 0) return null;

  const W = Math.max(400, xLabels.length * 70 + 80);
  const H = height;
  const pad = { top: 40, right: 30, bottom: 50, left: 70 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Find range
  const allValues = lines.flatMap(l => l.data);
  const yMin = Math.min(0, ...allValues) * (allValues.every(v => v >= 0) ? 0.9 : 1.1);
  const yMax = Math.max(...allValues) * 1.1;
  const yRange = yMax - yMin || 1;

  const toY = (v: number) => pad.top + plotH - ((v - yMin) / yRange) * plotH;
  const toX = (i: number) => pad.left + (i / Math.max(1, xLabels.length - 1)) * plotW;

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + yRange * i / 4);

  const fmtAxis = (v: number) => {
    if (Math.abs(v) >= 1e8) return `${(v/1e8).toFixed(1)}亿`;
    if (Math.abs(v) >= 1e4) return `${(v/1e4).toFixed(0)}万`;
    return v.toFixed(0);
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',maxWidth:W,background:'#0d1a1a',borderRadius:8}}>
      {title && <text x={W/2} y={22} textAnchor="middle" fill="#8ba8a8" fontSize={13} fontWeight="bold">{title}</text>}

      {/* Grid */}
      {yTicks.map((y, i) => (
        <g key={`g${i}`}>
          <line x1={pad.left} y1={toY(y)} x2={W-pad.right} y2={toY(y)} stroke="#1a3a3a" strokeWidth={0.5} />
          <text x={pad.left-6} y={toY(y)+4} textAnchor="end" fill="#5a7a7a" fontSize={9}>{fmtAxis(y)}</text>
        </g>
      ))}

      {/* X labels */}
      {xLabels.map((l, i) => (
        <text key={`xl${i}`} x={toX(i)} y={H-pad.bottom+16} textAnchor="middle" fill="#5a7a7a" fontSize={9}>{l}</text>
      ))}

      {/* Lines */}
      {lines.map((line, li) => {
        const points = line.data.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
        return (
          <g key={li}>
            <polyline points={points} fill="none" stroke={line.color} strokeWidth={2}
              strokeDasharray={line.dashed ? '6,3' : 'none'} opacity={0.8} />
            {/* Dots */}
            {line.data.map((v, i) => (
              <circle key={i} cx={toX(i)} cy={toY(v)} r={3} fill={line.color} stroke="#0d1a1a" strokeWidth={1} />
            ))}
            {/* Label on last point */}
            {line.data.length > 0 && (
              <text x={toX(line.data.length - 1) + 6} y={toY(line.data[line.data.length - 1]) + 3}
                fill={line.color} fontSize={10} fontWeight="bold">{line.label}</text>
            )}
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${pad.left},${H - pad.bottom + 35})`}>
        {lines.map((l, i) => (
          <g key={i} transform={`translate(${i * 100},0)`}>
            <line x1={0} y1={0} x2={20} y2={0} stroke={l.color} strokeWidth={2}
              strokeDasharray={l.dashed ? '6,3' : 'none'} />
            <text x={24} y={4} fill="#8ba8a8" fontSize={9}>{l.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
};
