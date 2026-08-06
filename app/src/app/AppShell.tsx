import { NavLink, Outlet } from 'react-router-dom';
import { RealtimeBacktestMonitorProvider } from '../features/securities/RealtimeBacktestMonitorProvider';
import { usePreMoveOutcomeScheduler } from '../features/securities/pre-move-radar/usePreMoveOutcomeScheduler';

export function AppShell() {
  usePreMoveOutcomeScheduler();
  return (
    <RealtimeBacktestMonitorProvider>
      <div className="app-shell">
        <aside className="sidebar">
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
          </nav>
          <p className="sidebar-note">严谨判断，来自可追溯的证据。</p>
        </aside>
        <main className="workspace">
          <Outlet />
        </main>
      </div>
    </RealtimeBacktestMonitorProvider>
  );
}
