import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { RealtimeBacktestMonitorProvider } from '../features/securities/RealtimeBacktestMonitorProvider';
import { usePreMoveOutcomeScheduler } from '../features/securities/pre-move-radar/usePreMoveOutcomeScheduler';

const SIDEBAR_COLLAPSED_KEY = 'app-shell:sidebar-collapsed';

export function AppShell() {
  usePreMoveOutcomeScheduler();
  // 侧栏折叠状态持久化到 localStorage，窄窗口时收起侧栏避免遮挡内容
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  return (
    <RealtimeBacktestMonitorProvider>
      <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
        {!collapsed && (
          <aside className="sidebar">
            <button className="sidebar-collapse" aria-label="折叠侧栏" title="折叠侧栏" onClick={() => setCollapsed(true)}>«</button>
            <div className="brand-lockup">
              <span className="brand-mark" aria-hidden="true">投</span>
              <div>
                <p className="brand-kicker">Investment Office</p>
                <p className="brand-title">投资尽调</p>
              </div>
            </div>
            <nav className="primary-nav" aria-label="主导航">
              <NavLink to="/" end>
                <span aria-hidden="true">01</span>
                投研项目
              </NavLink>
              <NavLink to="/securities">
                <span aria-hidden="true">02</span>
                证券项目
              </NavLink>
              <NavLink to="/ai-agents">
                <span aria-hidden="true">03</span>
                AI Agent 配置
              </NavLink>
            </nav>
            <p className="sidebar-note">严谨判断，来自可追溯的证据。</p>
          </aside>
        )}
        <main className="workspace">
          {collapsed && (
            <button className="sidebar-expand" aria-label="展开侧栏" title="展开侧栏" onClick={() => setCollapsed(false)}>☰</button>
          )}
          <Outlet />
        </main>
      </div>
    </RealtimeBacktestMonitorProvider>
  );
}
