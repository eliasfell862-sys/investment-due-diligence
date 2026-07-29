import { useState } from 'react';
import { useParams } from 'react-router-dom';

interface CompanyData {
  name: string;
  founded: string;
  headquarters: string;
  website: string;
  businessModel: string;
  description: string;
  milestones: string[];
}

export function CompanyOverviewPage() {
  const { projectId = "default" } = useParams<{ projectId: string }>();
  const [data, setData] = useState<CompanyData>(() => {
    const saved = localStorage.getItem(`dd-p-${projectId}-company-overview`);
    return saved ? JSON.parse(saved) : { name: '', founded: '', headquarters: '', website: '', businessModel: '', description: '', milestones: [] };
  });

  const save = (update: Partial<CompanyData>) => {
    const next = { ...data, ...update };
    setData(next);
    localStorage.setItem(`dd-p-${projectId}-company-overview`, JSON.stringify(next));
  };

  return (
    <div className="module-page">
      <h1>公司概览</h1>
      <form className="module-form" onSubmit={(e) => e.preventDefault()}>
        <label>公司名称<input value={data.name} onChange={(e) => save({ name: e.target.value })} /></label>
        <label>成立时间<input value={data.founded} onChange={(e) => save({ founded: e.target.value })} placeholder="YYYY-MM" /></label>
        <label>总部所在地<input value={data.headquarters} onChange={(e) => save({ headquarters: e.target.value })} /></label>
        <label>网站<input value={data.website} onChange={(e) => save({ website: e.target.value })} /></label>
        <label>商业模式<select value={data.businessModel} onChange={(e) => save({ businessModel: e.target.value })}>
          <option value="">请选择</option>
          <option value="saas">SaaS / 订阅</option>
          <option value="ecommerce">电商 / 交易平台</option>
          <option value="hardware">硬件 / 制造</option>
          <option value="service">服务 / 项目制</option>
          <option value="advertising">广告 / 流量变现</option>
          <option value="other">其他</option>
        </select></label>
        <label>业务描述<textarea value={data.description} onChange={(e) => save({ description: e.target.value })} rows={4} /></label>
        <label>关键里程碑<textarea
          value={(data.milestones || []).join('\n')}
          onChange={(e) => save({ milestones: e.target.value.split('\n').filter(Boolean) })}
          rows={4}
          placeholder="每行一个里程碑"
        /></label>
      </form>
    </div>
  );
}
