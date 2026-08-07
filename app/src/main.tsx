import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AiVaultProvider } from './features/ai-agents/AiVaultProvider';
import { AuthProvider } from './features/auth/AuthProvider';
import './index.css';
import './infrastructure/import/excel-importer';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AiVaultProvider>
        <App />
      </AiVaultProvider>
    </AuthProvider>
  </StrictMode>,
);
