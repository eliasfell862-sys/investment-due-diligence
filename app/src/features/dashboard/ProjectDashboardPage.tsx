import type { Readiness } from '../../domain/readiness/calculate-readiness';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import { StatusBadge } from '../../shared/ui/StatusBadge';

export interface ProjectDashboardPageProps {
  readonly readiness: Readiness;
}

function missingFieldLabel(fieldId: string): string {
  return findTargetFieldDefinition(fieldId)?.label ?? '未识别字段';
}

function exportGuidance(readiness: Readiness): string {
  if (readiness.canExport) {
    return '必填字段与数据冲突均已检查完毕，可以生成 Word 尽调报告。';
  }
  if (
    readiness.missingFieldIds.length > 0 &&
    readiness.unresolvedConflictCount > 0
  ) {
    return `请先补齐 ${readiness.missingFieldIds.length} 项关键字段，并解决 ${readiness.unresolvedConflictCount} 组数据冲突，再导出 Word 尽调报告。`;
  }
  if (readiness.unresolvedConflictCount > 0) {
    return '请先解决所有数据冲突，再导出 Word 尽调报告。';
  }
  return '继续补充关键字段后，即可进入导出环节。';
}

export function ProjectDashboardPage({ readiness }: ProjectDashboardPageProps) {
  const hasMissingFields = readiness.missingFieldIds.length > 0;
  const hasConflicts = readiness.unresolvedConflictCount > 0;

  return (
    <main className="page dashboard-page">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">Due Diligence Readiness</p>
          <h1>项目总览</h1>
          <p className="page-intro">
            汇总关键字段、数据冲突与报告导出条件，让项目团队快速识别下一项尽调动作。
          </p>
        </div>
        <StatusBadge
          tone={readiness.canExport ? 'good' : 'warning'}
          ariaLabel={readiness.canExport ? '项目已满足导出条件' : '项目仍有待办事项'}
        >
          {readiness.canExport ? '就绪' : '待完善'}
        </StatusBadge>
      </header>

      <section className="readiness-grid" aria-label="项目就绪度指标">
        <article className="metric-card metric-card-primary">
          <p className="metric-label">数据完整度</p>
          <strong className="metric-value">{readiness.completenessPct}%</strong>
          <progress
            className="readiness-progress"
            value={readiness.completenessPct}
            max={100}
            aria-label="数据完整度"
          />
          <StatusBadge
            tone={
              readiness.completenessPct === 100
                ? 'good'
                : readiness.completenessPct === 0
                  ? 'danger'
                  : 'warning'
            }
            ariaLabel={`数据完整度 ${readiness.completenessPct}%`}
          >
            {readiness.completenessPct === 100 ? '字段齐备' : '仍需补充'}
          </StatusBadge>
        </article>

        <article className="metric-card">
          <p className="metric-label">待补字段</p>
          <strong className="metric-value">{readiness.missingFieldIds.length} 项</strong>
          <StatusBadge
            tone={hasMissingFields ? 'warning' : 'good'}
            ariaLabel={hasMissingFields ? '仍有必填字段待补充' : '必填字段已齐备'}
          >
            {hasMissingFields ? '待录入' : '已齐备'}
          </StatusBadge>
        </article>

        <article className="metric-card">
          <p className="metric-label">未解决冲突</p>
          <strong className="metric-value">{readiness.unresolvedConflictCount} 组</strong>
          <StatusBadge
            tone={hasConflicts ? 'danger' : 'good'}
            ariaLabel={
              hasConflicts
                ? `存在 ${readiness.unresolvedConflictCount} 组未解决冲突`
                : '没有未解决冲突'
            }
          >
            {hasConflicts ? '需核验' : '无冲突'}
          </StatusBadge>
        </article>

        <article className="metric-card metric-card-export">
          <p className="metric-label">Word 导出准备度</p>
          <strong className="metric-value metric-value-text">
            {readiness.canExport ? '可导出' : '暂不可导出'}
          </strong>
          <StatusBadge
            tone={readiness.canExport ? 'good' : 'danger'}
            ariaLabel={readiness.canExport ? 'Word 导出已就绪' : 'Word 导出尚未就绪'}
          >
            {readiness.canExport ? '已就绪' : '尚未就绪'}
          </StatusBadge>
        </article>
      </section>

      <section className="dashboard-detail" aria-labelledby="missing-fields-heading">
        <div className="dashboard-detail-heading">
          <div>
            <p className="eyebrow">Required Fields</p>
            <h2 id="missing-fields-heading">待补字段清单</h2>
          </div>
          <span className="detail-count" aria-hidden="true">
            {String(readiness.missingFieldIds.length).padStart(2, '0')}
          </span>
        </div>

        {hasMissingFields ? (
          <ul className="missing-field-list">
            {readiness.missingFieldIds.map((fieldId, index) => (
              <li key={fieldId}>
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <strong>{missingFieldLabel(fieldId)}</strong>
                <small>必填信息尚未形成有效规范值</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dashboard-empty-note">暂无待补字段</p>
        )}
      </section>

      <section className="export-readiness" aria-labelledby="export-readiness-heading">
        <div>
          <p className="eyebrow">Report Gate</p>
          <h2 id="export-readiness-heading">Word 报告导出</h2>
        </div>
        <p>{exportGuidance(readiness)}</p>
      </section>
    </main>
  );
}
