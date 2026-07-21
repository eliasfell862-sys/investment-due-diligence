import { Link } from 'react-router-dom';

export function ProjectListPage() {
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
      <div className="empty-state">
        <p className="empty-state-index">01 — PROJECTS</p>
        <div>
          <h2>从一份清晰的投资命题开始</h2>
          <p>创建项目并选择行业模板，搭建本次尽调的分析框架。</p>
        </div>
      </div>
    </section>
  );
}
