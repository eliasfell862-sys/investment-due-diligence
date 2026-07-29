import { useState } from 'react';
import { useParams } from 'react-router-dom';

interface TeamMember {
  id: string;
  name: string;
  role: string;
  background: string;
  ownership: string;
  isKey: boolean;
}

export function TeamAssessmentPage() {
  const { projectId = "default" } = useParams<{ projectId: string }>();
  const [members, setMembers] = useState<TeamMember[]>(() => {
    const saved = localStorage.getItem(`dd-p-${projectId}-team-members`);
    return saved ? JSON.parse(saved) : [];
  });

  const add = () => setMembers([...members, { id: crypto.randomUUID(), name: '', role: '', background: '', ownership: '', isKey: false }]);
  const update = (id: string, field: keyof TeamMember, value: unknown) => {
    const next = members.map((m) => m.id === id ? { ...m, [field]: value } : m);
    setMembers(next);
    localStorage.setItem(`dd-p-${projectId}-team-members`, JSON.stringify(next));
  };
  const remove = (id: string) => {
    const next = members.filter((m) => m.id !== id);
    setMembers(next);
    localStorage.setItem(`dd-p-${projectId}-team-members`, JSON.stringify(next));
  };

  return (
    <div className="module-page">
      <h1>团队评估</h1>
      <button onClick={add} className="primary-link">+ 添加成员</button>
      {members.map((m) => (
        <div key={m.id} className="card">
          <input placeholder="姓名" value={m.name} onChange={(e) => update(m.id, 'name', e.target.value)} />
          <input placeholder="角色" value={m.role} onChange={(e) => update(m.id, 'role', e.target.value)} />
          <textarea placeholder="背景经历" value={m.background} onChange={(e) => update(m.id, 'background', e.target.value)} rows={2} />
          <input placeholder="持股比例" value={m.ownership} onChange={(e) => update(m.id, 'ownership', e.target.value)} />
          <label><input type="checkbox" checked={m.isKey} onChange={(e) => update(m.id, 'isKey', e.target.checked)} />关键人物</label>
          <button onClick={() => remove(m.id)} className="danger">删除</button>
        </div>
      ))}
    </div>
  );
}
