import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StrategyLearningLabPage } from './StrategyLearningLabPage';

describe('StrategyLearningLabPage', () => {
  it('renders as an independent stock workspace', async () => {
    render(<MemoryRouter><StrategyLearningLabPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '策略学习实验室' })).toBeInTheDocument();
    expect(screen.getByText('每日复盘')).toBeInTheDocument();
    expect(screen.getByText('问题模式')).toBeInTheDocument();
    expect(screen.getByText('候选策略')).toBeInTheDocument();
    expect(screen.getByText('策略审批')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出学习数据' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '个股分析' })).not.toBeInTheDocument();
  });
});
