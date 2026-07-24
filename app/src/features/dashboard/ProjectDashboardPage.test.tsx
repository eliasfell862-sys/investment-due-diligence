import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ReportReadiness } from '../../domain/readiness/calculate-report-readiness';
import { ProjectDashboardPage } from './ProjectDashboardPage';

function readiness(overrides: Partial<ReportReadiness> = {}): ReportReadiness {
  return {
    quickLook: {
      canExport: true,
      missingFieldIds: [],
      blockingReasons: [],
    },
    formal: {
      canExport: true,
      missingFieldIds: [],
      blockingReasons: [],
    },
    pendingCandidateCount: 0,
    unresolvedConflictCount: 0,
    decisionState: 'ready',
    ...overrides,
  };
}

describe('ProjectDashboardPage', () => {
  it('shows both report gates, review counts, formal missing fields, and the hold decision', () => {
    render(
      <ProjectDashboardPage
        readiness={readiness({
          quickLook: {
            canExport: false,
            missingFieldIds: ['business_description', 'team_summary'],
            blockingReasons: ['missing-core-fields', 'missing-summary'],
          },
          formal: {
            canExport: false,
            missingFieldIds: ['business_description', 'revenue', 'gross_margin'],
            blockingReasons: ['missing-required-fields'],
          },
          pendingCandidateCount: 2,
          decisionState: 'insufficient-data',
        })}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '\u9879\u76ee\u603b\u89c8' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '\u9879\u76ee\u901f\u89c8\u62a5\u544a' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55' })).toBeInTheDocument();
    expect(screen.getByText('2 \u9879\u5f85\u5ba1\u6838')).toBeInTheDocument();
    expect(screen.getByText('0 \u7ec4\u672a\u89e3\u51b3')).toBeInTheDocument();
    expect(screen.getByText('\u8d44\u6599\u4e0d\u8db3\uff0c\u6682\u7f13\u51b3\u7b56')).toBeInTheDocument();

    const formalGate = screen.getByRole('article', { name: '\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55' });
    expect(within(formalGate).getByText('\u4e1a\u52a1\u63cf\u8ff0')).toBeInTheDocument();
    expect(within(formalGate).getByText('\u8425\u4e1a\u6536\u5165')).toBeInTheDocument();
    expect(within(formalGate).getByText('\u6bdb\u5229\u7387')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '\u5bfc\u51fa\u9879\u76ee\u901f\u89c8\u62a5\u544a' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '\u5bfc\u51fa\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55' })).toBeDisabled();
  });

  it('shows quick-look as eligible while the formal memo remains blocked', () => {
    render(
      <ProjectDashboardPage
        readiness={readiness({
          formal: {
            canExport: false,
            missingFieldIds: ['revenue', 'gross_margin'],
            blockingReasons: ['missing-required-fields'],
          },
          pendingCandidateCount: 2,
          decisionState: 'insufficient-data',
        })}
      />,
    );

    const quickLookGate = screen.getByRole('article', { name: '\u9879\u76ee\u901f\u89c8\u62a5\u544a' });
    const formalGate = screen.getByRole('article', { name: '\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55' });
    expect(within(quickLookGate).getAllByText('\u5df2\u6ee1\u8db3\u6761\u4ef6')).not.toHaveLength(0);
    expect(within(formalGate).getAllByText('\u5c1a\u672a\u6ee1\u8db3\u6761\u4ef6')).not.toHaveLength(0);
  });

  it('surfaces conflicts without blocking an otherwise eligible quick-look', () => {
    render(
      <ProjectDashboardPage
        readiness={readiness({
          formal: {
            canExport: false,
            missingFieldIds: [],
            blockingReasons: ['unresolved-conflicts'],
          },
          unresolvedConflictCount: 2,
          decisionState: 'conflicted',
        })}
      />,
    );

    expect(screen.getByText('2 \u7ec4\u672a\u89e3\u51b3')).toBeInTheDocument();
    expect(screen.getByText('\u5b58\u5728\u672a\u89e3\u51b3\u51b2\u7a81\uff0c\u6682\u7f13\u51b3\u7b56')).toBeInTheDocument();
    const quickLookGate = screen.getByRole('article', { name: '\u9879\u76ee\u901f\u89c8\u62a5\u544a' });
    expect(within(quickLookGate).getAllByText('\u5df2\u6ee1\u8db3\u6761\u4ef6')).not.toHaveLength(0);
  });

  it('shows a ready decision when the formal gate is satisfied', () => {
    render(<ProjectDashboardPage readiness={readiness()} />);

    expect(screen.getByText('\u5df2\u6ee1\u8db3\u6b63\u5f0f\u62a5\u544a\u6761\u4ef6')).toBeInTheDocument();
    expect(screen.queryByText('\u8d44\u6599\u4e0d\u8db3\uff0c\u6682\u7f13\u51b3\u7b56')).not.toBeInTheDocument();
    expect(screen.getByText('\u6682\u65e0\u5f85\u8865\u5b57\u6bb5')).toBeInTheDocument();
  });

  it('shows project context and a Data Room link when routed', () => {
    render(
      <MemoryRouter>
        <ProjectDashboardPage
          readiness={readiness()}
          projectName={'\u793a\u4f8b\u9879\u76ee'}
          dataRoomHref="/projects/project-1/data-room"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('\u793a\u4f8b\u9879\u76ee')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '\u8fdb\u5165\u8d44\u6599\u4e2d\u5fc3' })).toHaveAttribute(
      'href',
      '/projects/project-1/data-room',
    );
  });
});
