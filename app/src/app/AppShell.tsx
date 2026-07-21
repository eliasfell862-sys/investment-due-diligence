import { NavLink, Outlet } from 'react-router-dom';

export function AppShell() {
  return (
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
            项目
          </NavLink>
        </nav>
        <p className="sidebar-note">严谨判断，来自可追溯的证据。</p>
      </aside>
      <main className="workspace">
        <Outlet />
      </main>
    </div>
  );
}
