import { useState } from 'react';
interface Product { name: string; stage: string; revenuePct: string; moat: string }
export function ProductPage() {
  const [products, setProducts] = useState<Product[]>(() => { const s = localStorage.getItem('dd-products'); return s ? JSON.parse(s) : []; });
  const [ip, setIp] = useState(() => localStorage.getItem('dd-ip') || '');
  const [rd, setRd] = useState(() => localStorage.getItem('dd-rd') || '');
  const add = () => setProducts([...products, { name: '', stage: 'R&D', revenuePct: '', moat: '' }]);
  const update = (i: number, f: string, v: string) => { const n = products.map((p, idx) => idx === i ? { ...p, [f]: v } : p); setProducts(n); localStorage.setItem('dd-products', JSON.stringify(n)); };
  const remove = (i: number) => { setProducts(products.filter((_, idx) => idx !== i)); };
  return (<div className="module-page"><h1>Product & Tech</h1><button onClick={add} className="primary-link">+ Add</button>
    {products.map((p, i) => (<div key={i} className="card flex-row">
      <input placeholder="Name" value={p.name} onChange={e => update(i, 'name', e.target.value)} />
      <select value={p.stage} onChange={e => update(i, 'stage', e.target.value)}><option>R&D</option><option>Beta</option><option>Released</option><option>Scale</option><option>Mature</option></select>
      <input placeholder="Revenue %" value={p.revenuePct} onChange={e => update(i, 'revenuePct', e.target.value)} />
      <input placeholder="Moat" value={p.moat} onChange={e => update(i, 'moat', e.target.value)} />
      <button onClick={() => remove(i)} className="danger">X</button>
    </div>))}
    <form className="module-form" onSubmit={e => e.preventDefault()}>
      <label>IP/Patents<textarea value={ip} onChange={e => { setIp(e.target.value); localStorage.setItem('dd-ip', e.target.value); }} rows={3} /></label>
      <label>R&D Pipeline<input value={rd} onChange={e => { setRd(e.target.value); localStorage.setItem('dd-rd', e.target.value); }} /></label>
    </form></div>);
}
