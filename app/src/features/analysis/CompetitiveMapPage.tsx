import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';

interface CompetitorDot {
  name: string;
  scale: number; // 规模（万）
  growth: number; // 增速（%）
  funding: number; // 融资金额（万）
  stage: string;
  isTarget: boolean;
}

function parseNum(s: unknown): number { return parseFloat(String(s ?? '0')) || 0; }

export function CompetitiveMapPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();

  const competitors = useMemo<CompetitorDot[]>(() => {
    try {
      const comps = JSON.parse(localStorage.getItem(`dd-p-${projectId}-competitors`) || '[]');
      const industry = JSON.parse(localStorage.getItem(`dd-p-${projectId}-industry`) || '{}');
      const fin = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financial`) || '{}');

      const targetRev = parseNum(fin.revenue || fin.revenue2025);
      const targetGrowth = parseNum(industry.growthRate);
      const targetFunding = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financing-history`) || '[]')
        .reduce((s: number, r: any) => s + parseNum(r.amount), 0);

      const dots: CompetitorDot[] = [{
        name: '标的公司',
        scale: targetRev || 1000,
        growth: targetGrowth || 20,
        funding: targetFunding || 500,
        stage: 'Target',
        isTarget: true,
      }];

      for (const c of comps) {
        if (!c.name) continue;
        dots.push({
          name: c.name,
          scale: parseNum(c.scale) || parseNum(c.revenue) || 500,
          growth: parseNum(c.growth || c.growthRate) || 10,
          funding: parseNum(c.funding) || parseNum(c.fundingAmount) || 100,
          stage: c.stage || '',
          isTarget: false,
        });
      }
      return dots;
    } catch { return []; }
  }, [projectId]);

  const [showLabels, setShowLabels] = useState(true);
  const [xAxisScale, setXAxisScale] = useState<'linear' | 'log'>('log');

  // SVG dimensions
  const W = 600, H = 420;
  const pad = { top: 30, right: 20, bottom: 50, left: 60 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Scales
  const xMin = Math.min(...competitors.map(c => c.scale)) * 0.5 || 1;
  const xMax = Math.max(...competitors.map(c => c.scale)) * 1.3 || 1000;
  const yMin = Math.min(0, Math.min(...competitors.map(c => c.growth)) - 5);
  const yMax = Math.max(...competitors.map(c => c.growth)) * 1.2 || 50;

  const toX = (v: number) => {
    if (xAxisScale === 'log') {
      const logMin = Math.log(Math.max(1, xMin));
      const logMax = Math.log(Math.max(1, xMax));
      return pad.left + ((Math.log(Math.max(1, v)) - logMin) / (logMax - logMin)) * plotW;
    }
    return pad.left + ((v - xMin) / (xMax - xMin)) * plotW;
  };
  const toY = (v: number) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const maxFunding = Math.max(...competitors.map(c => c.funding), 1);
  const bubbleR = (funding: number) => Math.max(8, Math.min(40, 8 + (funding / maxFunding) * 32));

  // Grid lines
  const xTicks = xAxisScale === 'log'
    ? [1, 10, 100, 1000, 10000, 100000, 1000000].filter(v => v >= xMin && v <= xMax)
    : Array.from({ length: 5 }, (_, i) => xMin + (xMax - xMin) * i / 4);
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (yMax - yMin) * i / 4);

  const fmtScale = (v: number) => v >= 1e6 ? `${(v/1e6).toFixed(1)}B` : v >= 1e4 ? `${(v/1e4).toFixed(0)}万` : v >= 1e3 ? `${(v/1e3).toFixed(1)}K` : v.toFixed(0);

  if (competitors.length === 0) {
    return (
      <div className="module-page">
        <h1>🗺️ 竞品地图</h1>
        <p style={{color:'#8ba8a8'}}>需要先在竞品对比中录入竞品数据（规模、增速、融资额），再回到此页面。</p>
      </div>
    );
  }

  return (
    <div className="module-page">
      <h1>🗺️ 竞品地图</h1>
      <p style={{color:'#8ba8a8',fontSize:'0.85rem',marginBottom:8}}>
        横轴 = 收入规模，纵轴 = 增速，气泡大小 = 融资金额。标的公司为实心点。
      </p>
      <div style={{display:'flex',gap:16,alignItems:'center',marginBottom:16}}>
        <label style={{fontSize:'0.85rem'}}>
          <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} /> 显示标签
        </label>
        <label style={{fontSize:'0.85rem'}}>
          横轴：<select value={xAxisScale} onChange={e => setXAxisScale(e.target.value as 'linear' | 'log')}>
            <option value="log">对数</option>
            <option value="linear">线性</option>
          </select>
        </label>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',maxWidth:700,background:'#0d1a1a',borderRadius:8}}>
        {/* Grid */}
        {yTicks.map((y, i) => (
          <g key={`y${i}`}>
            <line x1={pad.left} y1={toY(y)} x2={W-pad.right} y2={toY(y)} stroke="#1a3a3a" strokeWidth={0.5} />
            <text x={pad.left-6} y={toY(y)+4} textAnchor="end" fill="#5a7a7a" fontSize={10}>{y.toFixed(0)}%</text>
          </g>
        ))}
        {xTicks.map((x, i) => (
          <g key={`x${i}`}>
            <line x1={toX(x)} y1={pad.top} x2={toX(x)} y2={H-pad.bottom} stroke="#1a3a3a" strokeWidth={0.5} />
            <text x={toX(x)} y={H-pad.bottom+16} textAnchor="middle" fill="#5a7a7a" fontSize={10}>{fmtScale(x)}</text>
          </g>
        ))}

        {/* Axis labels */}
        <text x={W/2} y={H-4} textAnchor="middle" fill="#8ba8a8" fontSize={11}>收入规模 →</text>
        <text x={12} y={H/2} textAnchor="middle" fill="#8ba8a8" fontSize={11} transform={`rotate(-90,12,${H/2})`}>增速 (%) →</text>

        {/* Quadrant lines */}
        <line x1={toX(xMin + (xMax-xMin)/2)} y1={pad.top} x2={toX(xMin + (xMax-xMin)/2)} y2={H-pad.bottom} stroke="#2a4a4a" strokeWidth={0.5} strokeDasharray="4,4" />
        <line x1={pad.left} y1={toY((yMax+yMin)/2)} x2={W-pad.right} y2={toY((yMax+yMin)/2)} stroke="#2a4a4a" strokeWidth={0.5} strokeDasharray="4,4" />

        {/* Quadrant labels */}
        <text x={toX(xMin + (xMax-xMin)*0.75)} y={toY((yMax+yMin)/2)-6} fill="#3a5a5a" fontSize={9} textAnchor="middle">规模大 · 高增速 ★</text>
        <text x={toX(xMin + (xMax-xMin)*0.25)} y={toY((yMax+yMin)/2)-6} fill="#3a5a5a" fontSize={9} textAnchor="middle">规模小 · 高增速</text>
        <text x={toX(xMin + (xMax-xMin)*0.75)} y={toY((yMax+yMin)/2)+14} fill="#3a5a5a" fontSize={9} textAnchor="middle">规模大 · 低增速</text>
        <text x={toX(xMin + (xMax-xMin)*0.25)} y={toY((yMax+yMin)/2)+14} fill="#3a5a5a" fontSize={9} textAnchor="middle">规模小 · 低增速</text>

        {/* Bubbles */}
        {competitors.map((c, i) => {
          const cx = toX(c.scale);
          const cy = toY(c.growth);
          const r = bubbleR(c.funding);
          const color = c.isTarget ? '#70b8b0' : `hsl(${200 + i * 40}, 40%, 50%)`;
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r}
                fill={c.isTarget ? color : 'none'}
                fillOpacity={c.isTarget ? 0.7 : 0}
                stroke={color}
                strokeWidth={c.isTarget ? 3 : 2}
                strokeOpacity={c.isTarget ? 1 : 0.6}
              />
              {showLabels && (
                <text x={cx} y={cy - r - 4} textAnchor="middle" fill={c.isTarget ? '#70b8b0' : '#aaa'} fontSize={c.isTarget ? 11 : 9} fontWeight={c.isTarget ? 'bold' : 'normal'}>
                  {c.name}
                  {c.stage && <tspan fill="#5a7a7a" fontSize={8}> ({c.stage})</tspan>}
                </text>
              )}
            </g>
          );
        })}

        {/* Legend */}
        <g transform={`translate(${W-140},${pad.top})`}>
          <rect x={0} y={0} width={130} height={60} rx={4} fill="#0d2020" stroke="#2a4a4a" />
          <circle cx={16} cy={16} r={6} fill="#70b8b0" fillOpacity={0.7} stroke="#70b8b0" strokeWidth={2} />
          <text x={28} y={20} fill="#aaa" fontSize={10}>标的公司</text>
          <circle cx={16} cy={38} r={6} fill="none" stroke="#6a9" strokeWidth={2} />
          <text x={28} y={42} fill="#aaa" fontSize={10}>竞品（气泡=融资额）</text>
        </g>
      </svg>

      {/* Data table */}
      <h2 style={{marginTop:24}}>竞品数据表</h2>
      <table className="data-table">
        <thead><tr><th>公司</th><th>阶段</th><th>规模(万)</th><th>增速(%)</th><th>融资(万)</th></tr></thead>
        <tbody>
          {competitors.map((c, i) => (
            <tr key={i} style={c.isTarget ? {background:'#1a3a3a',fontWeight:'bold'} : {}}>
              <td>{c.name}{c.isTarget ? ' 🎯' : ''}</td>
              <td>{c.stage}</td>
              <td>{fmtScale(c.scale)}</td>
              <td style={{color: c.growth >= 20 ? '#70b8b0' : c.growth >= 0 ? '#ddd' : '#f87171'}}>{c.growth}%</td>
              <td>{fmtScale(c.funding)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
