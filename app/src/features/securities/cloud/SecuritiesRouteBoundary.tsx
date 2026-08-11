import type { ReactNode } from 'react';
import { readAuthEnvironment } from '../../../infrastructure/cloud/cloud-environment';
import { SecuritiesDataSourceProvider } from './SecuritiesDataSourceProvider';

export function SecuritiesRouteBoundary({ children }: { children: ReactNode }) {
  if (!readAuthEnvironment(import.meta.env)) return <>{children}</>;
  return <SecuritiesDataSourceProvider>{children}</SecuritiesDataSourceProvider>;
}
