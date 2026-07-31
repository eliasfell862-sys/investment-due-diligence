import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SecuritiesWorkbenchPage } from './SecuritiesWorkbenchPage';

describe('SecuritiesWorkbenchPage', () => {
  it('renders an independent securities workbench shell', () => {
    render(<SecuritiesWorkbenchPage />);

    expect(screen.getByRole('heading', { name: '证券项目工作台' })).toBeInTheDocument();
    expect(
      screen.getByText('股票 · 基金 · 债券 · ETF 综合研究平台'),
    ).toBeInTheDocument();
    expect(screen.getByText('Securities / 证券研究')).toBeInTheDocument();
    expect(screen.queryByText('新建投研项目')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '投研项目列表' })).not.toBeInTheDocument();
  });
});