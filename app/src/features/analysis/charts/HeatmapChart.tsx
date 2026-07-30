/** SVG Heatmap — 5x5 sensitivity matrix */
import React from 'react';

export interface HeatmapCell {
  rowLabel: string;
  colLabel: string;
  value: number; // for display
  colorValue: number; // 0-1 for coloring (0=cold/red, 1=hot/green)
}

interface Props {
  title?: string;
  rowLabel: string;
  colLabel: string;
  rows: readonly string[];
  cols: readonly string[];
  cells: readonly HeatmapCell[];
  valueFormatter?: (v: number) => string;
}

export const HeatmapChart: React.FC<Props> = ({
  title, rowLabel, colLabel, rows, cols, cells, valueFormatter = (v) => `${v.toFixed(1)}%`,
}) => {
  const cellW = 80, cellH = 44;
  const leftPad = 80, topPad = title ? 50 : 30;
  const W = leftPad + cols.length * cellW + 20;
  const H = topPad + rows.length * cellH + 30;

  const cellMap = new Map<string, HeatmapCell>();
  for (const c of cells) {
    cellMap.set(`${c.rowLabel}|${c.colLabel}`, c);
  }

  const getColor = (t: number) => {
    // Red (cold) → Yellow (medium) → Green (hot)
    if (t >= 0.8) return `rgb(${Math.round(80 + (1-t)*80)},${Math.round(180 + t*20)},${Math.round(140 - t*60)})`;
    if (t >= 0.5) return `rgb(${Math.round(180 + (t-0.5)*40)},${Math.round(150 + t*20)},${Math.round(60 + (t-0.5)*20)})`;
    if (t >= 0.3) return `rgb(${Math.round(200 + t*20)},${Math.round(120 + t*30)},${Math.round(40 + t*20)})`;
    return `rgb(${Math.round(220 - t*50)},${Math.round(80 + t*50)},${Math.round(30 + t*20)})`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',maxWidth:W,background:'#0d1a1a',borderRadius:8}}>
      {title && <text x={W/2} y={24} textAnchor="middle" fill="#8ba8a8" fontSize={13} fontWeight="bold">{title}</text>}

      {/* Column headers */}
      {cols.map((c, i) => (
        <text key={`ch-${i}`} x={leftPad + i * cellW + cellW/2} y={topPad - 8} textAnchor="middle" fill="#8ba8a8" fontSize={10}>
          {c}
        </text>
      ))}

      {/* Row headers */}
      {rows.map((r, i) => (
        <text key={`rh-${i}`} x={leftPad - 8} y={topPad + i * cellH + cellH/2 + 4} textAnchor="end" fill="#8ba8a8" fontSize={10}>
          {r}
        </text>
      ))}

      {/* Cells */}
      {rows.map((row, ri) =>
        cols.map((col, ci) => {
          const key = `${row}|${col}`;
          const cell = cellMap.get(key);
          if (!cell) return null;
          const x = leftPad + ci * cellW;
          const y = topPad + ri * cellH;
          return (
            <g key={key}>
              <rect x={x} y={y} width={cellW - 2} height={cellH - 2} rx={4}
                fill={getColor(cell.colorValue)} opacity={0.85} />
              <text x={x + (cellW-2)/2} y={y + (cellH-2)/2 + 1} textAnchor="middle" dominantBaseline="middle"
                fill="#fff" fontSize={11} fontWeight="bold">
                {valueFormatter(cell.value)}
              </text>
            </g>
          );
        })
      )}

      {/* Axis labels */}
      <text x={W/2} y={H - 6} textAnchor="middle" fill="#5a7a7a" fontSize={10}>{colLabel}</text>
      <text x={12} y={H/2} textAnchor="middle" fill="#5a7a7a" fontSize={10} transform={`rotate(-90,12,${H/2})`}>
        {rowLabel}
      </text>
    </svg>
  );
};
