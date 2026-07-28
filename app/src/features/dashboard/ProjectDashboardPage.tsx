import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import type {
  ReportGate,
  ReportReadiness,
} from '../../domain/readiness/calculate-report-readiness';
import { StatusBadge } from '../../shared/ui/StatusBadge';

export interface ProjectDashboardPageProps {
  readonly readiness: ReportReadiness;
  readonly projectName?: string;
  readonly projectId?: string;
  readonly dataRoomHref?: string;
}

const text = {
  title: '\u9879\u76ee\u603b\u89c8',
  intro: '\u6c47\u603b\u672c\u5730\u8d44\u6599\u3001\u5f85\u5ba1\u6838\u5019\u9009\u3001\u6570\u636e\u51b2\u7a81\u4e0e\u4e24\u7c7b\u62a5\u544a\u95e8\u69db\u3002',
  dataRoom: '\u8fdb\u5165\u8d44\u6599\u4e2d\u5fc3',
  pendingCandidates: '\u5f85\u5ba1\u6838\u5019\u9009',
  unresolvedConflicts: '\u672a\u89e3\u51b3\u51b2\u7a81',
  pendingSuffix: '\u9879\u5f85\u5ba1\u6838',
  conflictSuffix: '\u7ec4\u672a\u89e3\u51b3',
  quickLook: '\u9879\u76ee\u901f\u89c8\u62a5\u544a',
  formal: '\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55',
  eligible: '\u5df2\u6ee1\u8db3\u6761\u4ef6',
  ineligible: '\u5c1a\u672a\u6ee1\u8db3\u6761\u4ef6',
  quickButton: '\u5bfc\u51fa\u9879\u76ee\u901f\u89c8\u62a5\u544a',
  formalButton: '\u5bfc\u51fa\u6b63\u5f0f\u6295\u8d44\u5907\u5fd8\u5f55',
  missingFields: '\u6b63\u5f0f\u62a5\u544a\u5f85\u8865\u5b57\u6bb5',
  noMissingFields: '\u6682\u65e0\u5f85\u8865\u5b57\u6bb5',
  missingFieldNote: '\u5c1a\u672a\u5f62\u6210\u6709\u6548\u89c4\u8303\u503c',
  insufficient: '\u8d44\u6599\u4e0d\u8db3\uff0c\u6682\u7f13\u51b3\u7b56',
  conflicted: '\u5b58\u5728\u672a\u89e3\u51b3\u51b2\u7a81\uff0c\u6682\u7f13\u51b3\u7b56',
  ready: '\u5df2\u6ee1\u8db3\u6b63\u5f0f\u62a5\u544a\u6761\u4ef6',
  readyBadge: '\u6b63\u5f0f\u62a5\u544a\u5c31\u7eea',
  pendingBadge: '\u9879\u76ee\u4ecd\u6709\u5f85\u529e\u4e8b\u9879',
  unknownField: '\u672a\u8bc6\u522b\u5b57\u6bb5',
} as const;

function fieldLabel(fieldId: string): string {
  return findTargetFieldDefinition(fieldId)?.label ?? text.unknownField;
}

function gateTone(gate: ReportGate): 'good' | 'danger' {
  return gate.canExport ? 'good' : 'danger';
}

function decisionMessage(readiness: ReportReadiness): string {
  if (readiness.decisionState === 'ready') return text.ready;
  if (readiness.decisionState === 'conflicted') return text.conflicted;
  return text.insufficient;
}

interface GateCardProps {
  readonly id: string;
  readonly title: string;
  readonly gate: ReportGate;
  readonly buttonLabel: string;
  readonly reportHref?: string;
  readonly children?: ReactNode;
}

function GateCard({
  id,
  title,
  gate,
  buttonLabel,
  reportHref,
  children,
}: GateCardProps) {
  return (
    <article className="metric-card metric-card-export" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <strong className="metric-value metric-value-text">
        {gate.canExport ? text.eligible : text.ineligible}
      </strong>
      <StatusBadge
        tone={gateTone(gate)}
        ariaLabel={gate.canExport ? text.eligible : text.ineligible}
      >
        {gate.canExport ? text.eligible : text.ineligible}
      </StatusBadge>
      {children}
      {gate.canExport && reportHref ? (
        <Link to={reportHref} className="button button-primary" style={{textDecoration:'none'}}>
          {buttonLabel}
        </Link>
      ) : (
        <button className="button" type="button" disabled>
          {buttonLabel}
        </button>
      )}
    </article>
  );
}

export function ProjectDashboardPage({
  readiness,
  projectName,
  projectId,
  dataRoomHref,
}: ProjectDashboardPageProps) {
  const hasFormalMissingFields = readiness.formal.missingFieldIds.length > 0;
  const isReady = readiness.decisionState === 'ready';

  return (
    <main className="page dashboard-page">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">Due Diligence Readiness</p>
          <h1>{text.title}</h1>
          {projectName && <p>{projectName}</p>}
          <p className="page-intro">{text.intro}</p>
        </div>
        <div>
          {dataRoomHref && <Link to={dataRoomHref}>{text.dataRoom}</Link>}
          {projectId && <Link to={`/projects/${projectId}/analysis`} style={{ marginLeft: 16 }}>分析</Link>}
          {projectId && <Link to={`/projects/${projectId}/research`} style={{ marginLeft: 16 }}>AI 研究</Link>}
          {projectId && <Link to={`/projects/${projectId}/report`} style={{ marginLeft: 16 }}>报告</Link>}
          <StatusBadge
            tone={isReady ? 'good' : 'warning'}
            ariaLabel={isReady ? text.readyBadge : text.pendingBadge}
          >
            {isReady ? text.readyBadge : text.pendingBadge}
          </StatusBadge>
        </div>
      </header>

      <p role="status">{decisionMessage(readiness)}</p>

      <section className="readiness-grid" aria-label="Report readiness gates">
        <article className="metric-card">
          <p className="metric-label">{text.pendingCandidates}</p>
          <strong className="metric-value">
            {readiness.pendingCandidateCount + ' ' + text.pendingSuffix}
          </strong>
        </article>

        <article className="metric-card">
          <p className="metric-label">{text.unresolvedConflicts}</p>
          <strong className="metric-value">
            {readiness.unresolvedConflictCount + ' ' + text.conflictSuffix}
          </strong>
        </article>

        <GateCard
          id="quick-look-report-heading"
          title={text.quickLook}
          gate={readiness.quickLook}
          buttonLabel={text.quickButton}
          reportHref={projectId ? `/projects/${projectId}/report` : undefined}
        />

        <GateCard
          id="formal-report-heading"
          title={text.formal}
          gate={readiness.formal}
          buttonLabel={text.formalButton}
          reportHref={projectId ? `/projects/${projectId}/report` : undefined}
        >
          <div className="dashboard-detail">
            <h3>{text.missingFields}</h3>
            {hasFormalMissingFields ? (
              <ul className="missing-field-list">
                {readiness.formal.missingFieldIds.map((fieldId) => (
                  <li key={fieldId}>
                    <strong>{fieldLabel(fieldId)}</strong>
                    <small>{text.missingFieldNote}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dashboard-empty-note">{text.noMissingFields}</p>
            )}
          </div>
        </GateCard>
      </section>
    </main>
  );
}
