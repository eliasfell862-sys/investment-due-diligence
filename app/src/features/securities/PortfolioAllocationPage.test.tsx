import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PortfolioAllocationPage } from './PortfolioAllocationPage';

vi.mock('./ActualPositionsPanel', () => ({
  ActualPositionsPanel: ({ projectId }: { projectId?: string }) => (
    <div data-testid="actual-positions-panel">actual:{projectId}</div>
  ),
}));

vi.mock('./AiPortfolioAllocationWorkspace', () => ({
  AiPortfolioAllocationWorkspace: () => (
    <div data-testid="ai-allocation-workspace">ai allocation</div>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/project-123/securities/portfolio']}>
      <Routes>
        <Route path="/projects/:projectId/securities/portfolio" element={<PortfolioAllocationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PortfolioAllocationPage tabs', () => {
  it('shows actual positions by default and switches to AI allocation on demand', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('heading', { name: '💰 持仓分配系统' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← 返回证券工作台' }))
      .toHaveAttribute('href', '/projects/project-123/securities');
    expect(screen.getByTestId('actual-positions-panel')).toHaveTextContent('actual:project-123');
    expect(screen.queryByTestId('ai-allocation-workspace')).not.toBeInTheDocument();

    const actualTab = screen.getByRole('tab', { name: '我的实际持仓' });
    const aiTab = screen.getByRole('tab', { name: 'AI 持仓分配' });
    expect(actualTab).toHaveAttribute('aria-selected', 'true');
    expect(aiTab).toHaveAttribute('aria-selected', 'false');

    await user.click(aiTab);

    expect(screen.getByTestId('ai-allocation-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('actual-positions-panel')).not.toBeInTheDocument();
    expect(actualTab).toHaveAttribute('aria-selected', 'false');
    expect(aiTab).toHaveAttribute('aria-selected', 'true');
  });
});
