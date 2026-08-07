import type { ReactNode } from 'react';
import { readCloudEnvironment } from '../../../infrastructure/cloud/cloud-environment';
import { SecuritiesDataSourceProvider } from './SecuritiesDataSourceProvider';

export function SecuritiesRouteBoundary({ children }: { children: ReactNode }) {
  if (!readCloudEnvironment(import.meta.env)) return <>{children}</>;
  return <SecuritiesDataSourceProvider>{children}</SecuritiesDataSourceProvider>;
}
