import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// 工作台内的 SignalInbox 依赖 RealtimeBacktestMonitorProvider 上下文；
// 测试把 AppShell mock 成 <Outlet />（不含 provider），这里补一个最小上下文。
const realtimeMock = vi.hoisted(() => ({
  monitor: {
    alerts: [], runtime: { virtualLedger: { positions: [], lots: [] } },
    virtualLedger: { positions: [], lots: [] }, prices: {}, unreadCount: 0, checking: false,
    partialFailureCount: 0, monitoringCount: 0, watchlistCount: 0, heldCount: 0, successfulCount: 0,
    lastScanAt: null, marketStatus: 'closed', lastUpdatedAt: null, error: '',
    refreshNow: async () => {}, markRead: () => {}, markExecuted: () => {}, clearAlerts: () => {},
    reloadLedger: async () => {},
  },
}));

vi.mock('../features/securities/RealtimeBacktestMonitorProvider', () => ({
  RealtimeBacktestMonitorProvider: ({ children }: { children: React.ReactNode }) => children,
  useRealtimeBacktestMonitorContext: () => realtimeMock.monitor,
}));

vi.mock('../features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-a', email: 'owner@example.com' },
    loading: false,
    cloudEnabled: true,
    configurationError: null,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
  }),
  useOptionalAuth: () => ({
    user: { id: 'user-a', email: 'owner@example.com' },
    loading: false,
    cloudEnabled: true,
    configurationError: null,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
  }),
}));

vi.mock('./AppShell', () => ({
  AppShell: () => <Outlet />,
}));

vi.mock('../features/securities/SecuritiesWorkbenchWithCloudMigration', () => ({
  SecuritiesWorkbenchPage: () => <h1>证券项目工作台</h1>,
  SecuritiesWorkbenchWithCloudMigration: () => <h1>{'\u8bc1\u5238\u9879\u76ee\u5de5\u4f5c\u53f0'}</h1>,
}));
vi.mock('../features/analysis/AnalysisWorkbench', () => ({
  AnalysisWorkbench: () => <><h1>投研分析工作台</h1><Outlet /></>,
}));
vi.mock('../features/analysis/FinancialPage', () => ({
  FinancialPage: () => <h2>财务分析页面</h2>,
}));
vi.mock('../features/reports/ReportExportPage', () => ({
  ReportExportPage: () => <h1>报告导出页面</h1>,
}));vi.mock('../features/ai-agents/AiAgentSettingsPage', () => ({
  AiAgentSettingsPage: () => <h1>AI Agent 配置</h1>,
}));
vi.mock('../features/securities/cloud/SecuritiesRouteBoundary', () => ({
  SecuritiesRouteBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="securities-route-boundary">{children}</div>
  ),
}));


import { appRoutes } from './router';

describe('application routes', () => {
  it('registers root and project pre-move radar routes', () => {
    const children = appRoutes[0]?.children ?? [];
    expect(children.some(route => route.path === 'securities/pre-move-radar')).toBe(true);
    expect(children.some(route => route.path === 'projects/:projectId/securities/pre-move-radar')).toBe(true);
  });

  it('renders the securities workbench at /securities for an authenticated user', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/securities'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '证券项目工作台' })).toBeInTheDocument();
  });

  it('places authenticated securities pages inside the securities data-source boundary', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/securities'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('securities-route-boundary')).toBeInTheDocument();
  });
  it('renders a lazily loaded investment analysis child route', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects/project-a/analysis/financial'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '财务分析页面' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '投研分析工作台' })).toBeInTheDocument();
  });

  it('renders a lazily loaded report route', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/projects/project-a/report'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: '报告导出页面' })).toBeInTheDocument();
  });
  it('renders the protected AI Agent settings page for an authenticated user', async () => {

    const router = createMemoryRouter(appRoutes, { initialEntries: ['/ai-agents'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'AI Agent 配置' })).toBeInTheDocument();
  });
});
