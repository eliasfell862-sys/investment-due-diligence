import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Readiness } from '../../domain/readiness/calculate-readiness';
import { ProjectDashboardPage } from './ProjectDashboardPage';

function readiness(overrides: Partial<Readiness> = {}): Readiness {
  return {
    missingFieldIds: [],
    presentFieldIds: [],
    completenessPct: 100,
    unresolvedConflictCount: 0,
    canExport: true,
    ...overrides,
  };
}

describe('ProjectDashboardPage', () => {
  it('renders an accessible zero-completeness dashboard with canonical missing labels', () => {
    render(
      <ProjectDashboardPage
        readiness={readiness({
          missingFieldIds: ['company_name', 'revenue'],
          completenessPct: 0,
          canExport: false,
        })}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '项目总览' })).toBeInTheDocument();
    const metrics = screen.getByRole('region', { name: '项目就绪度指标' });
    expect(within(metrics).getByText('0%')).toBeInTheDocument();
    expect(within(metrics).getByRole('progressbar', { name: '数据完整度' })).toHaveAttribute('value', '0');
    expect(within(metrics).getByText('2 项')).toBeInTheDocument();
    expect(screen.getByText('公司名称')).toBeInTheDocument();
    expect(screen.getByText('营业收入')).toBeInTheDocument();
    expect(screen.queryByText('company_name')).not.toBeInTheDocument();
    expect(screen.queryByText('revenue')).not.toBeInTheDocument();
    expect(screen.getByText('尚未就绪')).toHaveAttribute(
      'data-tone',
      'danger',
    );
  });

  it('shows partial completeness and the remaining canonical field', () => {
    render(
      <ProjectDashboardPage
        readiness={readiness({
          missingFieldIds: ['gross_margin'],
          presentFieldIds: ['company_name'],
          completenessPct: 50,
          canExport: false,
        })}
      />,
    );

    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '数据完整度' })).toHaveAttribute(
      'value', '50',
    );
    expect(screen.getByText('1 项')).toBeInTheDocument();
    expect(screen.getByText('毛利率')).toBeInTheDocument();
    expect(screen.getByText('继续补充关键字段后，即可进入导出环节。')).toBeInTheDocument();
  });

  it('shows a complete project as ready for Word export', () => {
    render(
      <ProjectDashboardPage
        readiness={readiness({
          presentFieldIds: ['company_name', 'revenue'],
        })}
      />,
    );

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '数据完整度' })).toHaveAttribute(
      'value', '100',
    );
    expect(screen.getByText('0 项')).toBeInTheDocument();
    expect(screen.getByText('暂无待补字段')).toBeInTheDocument();
    expect(screen.getByText('已就绪')).toHaveAttribute('data-tone', 'good');
  });

  it('surfaces unresolved conflict groups and blocks export independently of completeness', () => {
    render(
      <ProjectDashboardPage
        readiness={readiness({
          presentFieldIds: ['revenue'],
          unresolvedConflictCount: 2,
          canExport: false,
        })}
      />,
    );

    expect(screen.getByText('2 组')).toBeInTheDocument();
    expect(screen.getByText('需核验')).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByText('尚未就绪')).toBeInTheDocument();
    expect(screen.getByText('请先解决所有数据冲突，再导出 Word 尽调报告。')).toBeInTheDocument();
  });

  it('lists missing fields and conflicts together when both block export', () => {
    render(
      <ProjectDashboardPage
        readiness={readiness({
          missingFieldIds: ['company_name', 'revenue'],
          completenessPct: 0,
          unresolvedConflictCount: 1,
          canExport: false,
        })}
      />,
    );

    expect(
      screen.getByText(
        '请先补齐 2 项关键字段，并解决 1 组数据冲突，再导出 Word 尽调报告。',
      ),
    ).toBeInTheDocument();
  });

  it('shows project context and a Data Room link when routed', () => {
    render(
      <MemoryRouter>
        <ProjectDashboardPage
          readiness={readiness()}
          projectName="示例项目"
          dataRoomHref="/projects/project-1/data-room"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('示例项目')).toBeInTheDocument();
    expect(screen.getByText('示例项目').closest('.page-intro')).toBeNull();
    expect(screen.getByRole('link', { name: '进入资料中心' })).toHaveAttribute(
      'href',
      '/projects/project-1/data-room',
    );
  });
});
