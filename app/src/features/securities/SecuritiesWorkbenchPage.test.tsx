import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SecuritiesWorkbenchPage } from './SecuritiesWorkbenchPage';

describe('SecuritiesWorkbenchPage', () => {
  it('renders an independent securities workbench shell', () => {
    render(<SecuritiesWorkbenchPage />);

    const heading = screen.getByRole('heading', { name: '证券项目工作台' });

    expect(heading).toBeInTheDocument();
    expect(heading.closest('.securities-workbench-page')).not.toBeNull();
    expect(
      screen.getByText('股票 · 基金 · 债券 · ETF 综合研究平台'),
    ).toBeInTheDocument();
    expect(screen.getByText('Securities / 证券研究')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '证券资产类别' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /股票/ })).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector('.securities-table-shell')).not.toBeNull();
    expect(screen.queryByText('新建投研项目')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '投研项目列表' })).not.toBeInTheDocument();
  });
});