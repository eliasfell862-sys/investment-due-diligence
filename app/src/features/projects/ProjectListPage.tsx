import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import type { Project } from '../../domain/project/project';
import type { ProjectRepository } from '../../infrastructure/db/project-repository';

export interface ProjectListPageProps {
  readonly repository: Pick<ProjectRepository, 'list' | 'delete'>;
}

type ProjectListState =
  | { readonly status: 'ready'; readonly projects: readonly Project[] }
  | { readonly status: 'error' };

export function ProjectListPage({ repository }: ProjectListPageProps) {
  const [retryCount, setRetryCount] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const state = useLiveQuery<ProjectListState>(async () => {
    try {
      return { status: 'ready', projects: await repository.list() };
    } catch {
      return { status: 'error' };
    }
  }, [repository, retryCount]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定删除项目「${name}」吗？\n项目数据将被永久清除，无法恢复。`)) return;
    setDeleting(id);
    try {
      await repository.delete(id);
      setRetryCount((c) => c + 1);
    } finally {
      setDeleting(null);
    }
  };
  return (
    <section className="page project-list-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Deal Review / 项目管理</p>
          <h1>项目工作台</h1>
          <p className="page-intro">建立统一的投资假设，组织每一项关键证据。</p>
        </div>
        <Link className="button button-primary" to="/projects/new">
          <span aria-hidden="true">＋</span>
          新建项目
        </Link>
      </header>
      {!state ? (
        <p role="status">正在读取项目…</p>
      ) : state.status === 'error' ? (
        <div>
          <p role="alert">无法读取本地项目，请重试。</p>
          <button type="button" onClick={() => setRetryCount((current) => current + 1)}>
            重新读取项目
          </button>
        </div>
      ) : state.projects.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-index">01 — PROJECTS</p>
          <div>
            <h2>从一份清晰的投资命题开始</h2>
            <p>创建项目并选择行业模板，搭建本次尽调的分析框架。</p>
          </div>
        </div>
      ) : (
        <section aria-label="项目列表">
          <ul>
            {state.projects.map((project) => (
              <li key={project.id} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid var(--line)'}}>
                <Link to={`/projects/${project.id}`} style={{flex:1}}>{project.name}</Link>
                <small style={{color:'var(--ink-500)'}}>{project.dealProfile?.strategy === 'vc_early' ? '早期VC' : project.dealProfile?.strategy === 'growth' ? '成长期' : project.dealProfile?.strategy === 'pe_buyout' ? 'PE' : ''}</small>
                <button onClick={() => handleDelete(project.id, project.name)} disabled={deleting === project.id}
                  style={{color:'var(--error)',background:'transparent',border:'1px solid var(--error)',padding:'4px 12px',cursor:'pointer',fontSize:'0.78rem'}}>
                  {deleting === project.id ? '删除中…' : '删除'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
