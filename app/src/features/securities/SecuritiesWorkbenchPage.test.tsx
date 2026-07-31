import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SecuritiesWorkbenchPage } from './SecuritiesWorkbenchPage';

describe('SecuritiesWorkbenchPage', () => {
  it('renders an independent securities workbench shell', () => {
    render(<SecuritiesWorkbenchPage />);

    expect(screen.getByRole('heading', { name: '证券项目工作台' })).toBeInTheDocument();
    expect(
      screen.getByText('从证券研究命题出发，逐步建立股票池、估值跟踪与投资判断。'),
    ).toBeInTheDocument();
    expect(screen.getByText('证券研究能力将在这里独立展开')).toBeInTheDocument();
    expect(screen.queryByText('新建投研项目')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '投研项目列表' })).not.toBeInTheDocument();
  });
});