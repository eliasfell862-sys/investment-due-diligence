import { readCloudEnvironment } from '../../../infrastructure/cloud/cloud-environment';
import { useAuth } from '../../auth/AuthProvider';
import { CloudMigrationPanel } from './CloudMigrationPanelBase';

export {
  CloudMigrationPanel,
  cloudMigrationCompletionKey,
  type LocalCloudMigrationRepository,
} from './CloudMigrationPanelBase';

function AuthenticatedCloudMigrationPanel() {
  const { user, cloudEnabled } = useAuth();
  if (!cloudEnabled || !user) return null;
  return <CloudMigrationPanel userId={user.id} />;
}

export function CloudMigrationPanelFromSession() {
  if (!readCloudEnvironment(import.meta.env)) return null;
  return <AuthenticatedCloudMigrationPanel />;
}
