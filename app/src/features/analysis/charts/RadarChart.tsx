/** SVG Radar/Spider chart for multi-dimensional risk visualization */
import React from 'react';

export interface RadarAxis {
  label: string;
  value: number; // 0-1
  color?: string;
}

interface Props {
  axes: readonly RadarAxis[];
  size?: number;
  label?: string;
}

const LEVELS = [0.2, 0.4, 0.6, 0.8, 1.0];

export const RadarChart: React.FC<Props> = ({ axes, size = 320, label }) => {
  const cx = size / 2, cy = size / 2;
  const radius = size * 0.35;
  const angleSlice = (2 * Math.PI) / axes.length;

  const getPoint = (i: number, value: number) => {
    const angle = angleSlice * i - Math.PI / 2;
    return {
      x: cx + radius * value * Math.cos(angle),
      y: cy + radius * value * Math.sin(angle),
    };
  };

  const getGridPoint = (i: number, level: number) => {
    const angle = angleSlice * i - Math.PI / 2;
    return {
      x: cx + radius * level * Math.cos(angle),
      y: cy + radius * level * Math.sin(angle),
    };
  };

  const dataPoints = axes.map((a, i) => getPoint(i, Math.max(0.02, a.value)));
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{overflow:'visible'}}>
      {/* Grid */}
      {LEVELS.map(level => {
        const points = axes.map((_, i) => getGridPoint(i, level));
        const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
        return (
          <g key={level}>
            <path d={path} fill="none" stroke="#2a4a4a" strokeWidth={level === 1 ? 1.5 : 0.5} />
            <text x={getGridPoint(0, level).x + 4} y={getGridPoint(0, level).y - 4} fill="#4a6a6a" fontSize={9}>
              {(level * 100).toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* Axis lines */}
      {axes.map((a, i) => {
        const p = getPoint(i, 1.05);
        return (
          <g key={`axis-${i}`}>
            <line x1={cx} y1={cy} x2={getPoint(i, 1).x} y2={getPoint(i, 1).y} stroke="#2a4a4a" strokeWidth={0.5} />
            <text
              x={p.x} y={p.y}
              textAnchor={p.x > cx ? 'start' : p.x < cx ? 'end' : 'middle'}
              dominantBaseline={p.y < cy ? 'auto' : 'hanging'}
              fill="#8ba8a8" fontSize={10}
            >
              {a.label}
            </text>
          </g>
        );
      })}

      {/* Data area */}
      <path d={dataPath} fill="rgba(112,184,176,0.15)" stroke="#70b8b0" strokeWidth={2} />

      {/* Data points */}
      {axes.map((a, i) => {
        const p = dataPoints[i];
        const color = a.value >= 0.7 ? '#f87171' : a.value >= 0.4 ? '#f0b870' : '#70b8b0';
        return (
          <g key={`pt-${i}`}>
            <circle cx={p.x} cy={p.y} r={4} fill={color} stroke="#0d1a1a" strokeWidth={1} />
            <text x={p.x} y={p.y - 10} textAnchor="middle" fill={color} fontSize={9} fontWeight="bold">
              {(a.value * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}

      {/* Label */}
      {label && <text x={cx} y={size - 8} textAnchor="middle" fill="#5a7a7a" fontSize={11}>{label}</text>}
    </svg>
  );
};
