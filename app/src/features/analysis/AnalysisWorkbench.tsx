import { useEffect, useState } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { appDb } from '../../infrastructure/db/app-db';
import { syncEvidenceToAnalysis } from '../../infrastructure/db/analysis-sync';

const MODULES = [
  { path: 'company', label: '公司概览' },
  { path: 'team', label: '团队评估' },
  { path: 'industry', label: '产业链与市场' },
  { path: 'competitors', label: '竞品对比' },
  { path: 'product', label: '产品与技术' },
  { path: 'financial', label: '财务分析' },
  { path: 'valuation', label: '估值模型' },
  { path: 'equity', label: '股权与融资' },
  { path: 'risk', label: '风险评估' },
  { path: 'exit', label: '退出路径' },
  { path: 'decision', label: '投资建议' },
] as const;

export function AnalysisWorkbench() {
  const { projectId } = useParams<{ projectId: string }>();
  const [syncMsg, setSyncMsg] = useState('');

  useEffect(() => {
    if (!projectId) return;
    syncEvidenceToAnalysis(appDb, projectId).then((result) => {
      if (result.synced > 0) setSyncMsg(`Synced ${result.synced} fields from evidence`);
    }).catch(() => {});
  }, [projectId]);

  return (
    <div className="analysis-workbench">
      <nav className="analysis-nav">
        <h3>分析工作台</h3>
        {syncMsg && <p style={{padding:'0 22px',color:'#70b8b0',fontSize:'0.75rem',margin:'0 0 12px'}}>{syncMsg}</p>}
        {MODULES.map((mod) => (
          <NavLink
            key={mod.path}
            to={`/projects/${projectId}/analysis/${mod.path}`}
            className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}
          >
            {mod.label}
          </NavLink>
        ))}
      </nav>
      <main className="analysis-content">
        <Outlet />
      </main>
    </div>
  );
}
