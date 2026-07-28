import { useState } from 'react';
import { checkBrowserCapabilities, getBrowserInfo, isChromiumBased } from '../../infrastructure/browser-check';

export function SystemStatusPage() {
  const [caps] = useState(() => checkBrowserCapabilities());
  const browser = getBrowserInfo();
  const isChromium = isChromiumBased();
  const allOk = caps.issues.length === 0;

  return (
    <div className="module-page">
      <h1>System Status</h1>
      <div className="results-grid" style={{marginBottom:20}}>
        <div className="metric-card"><strong>{browser}</strong><span>Browser</span></div>
        <div className="metric-card"><strong>{isChromium ? 'Yes' : 'No'}</strong><span>Chromium</span></div>
        <div className={`metric-card ${allOk ? '' : 'metric-card-primary'}`}><strong>{allOk ? 'OK' : `${caps.issues.length} issues`}</strong><span>Status</span></div>
      </div>
      <table className="data-table">
        <thead><tr><th>Feature</th><th>Available</th></tr></thead>
        <tbody>
          <tr><td>IndexedDB</td><td>{caps.indexedDB ? 'Yes' : 'No'}</td></tr>
          <tr><td>Web Workers</td><td>{caps.webWorker ? 'Yes' : 'No'}</td></tr>
          <tr><td>Blob API</td><td>{caps.blob ? 'Yes' : 'No'}</td></tr>
          <tr><td>Crypto API</td><td>{caps.crypto ? 'Yes' : 'No'}</td></tr>
          <tr><td>localStorage</td><td>{caps.localStorage ? 'Yes' : 'No'}</td></tr>
          <tr><td>ES2020+</td><td>{caps.es2020 ? 'Yes' : 'No'}</td></tr>
        </tbody>
      </table>
      {caps.issues.length > 0 && caps.issues.map((issue, i) => <div key={i} className="loss-info">{issue}</div>)}
      {allOk && <div className="loss-info" style={{background:'#dff3e6',borderLeftColor:'#16766f'}}>All browser features available. The app should work correctly.</div>}
    </div>
  );
}
