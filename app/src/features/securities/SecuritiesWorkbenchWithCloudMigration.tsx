import { CloudMigrationPanelFromSession } from './cloud/CloudMigrationPanel';
import { SecuritiesWorkbenchPage as SecuritiesWorkbenchPageBase } from './SecuritiesWorkbenchPageBase';

export function SecuritiesWorkbenchWithCloudMigration() {
  return (
    <>
      <CloudMigrationPanelFromSession />
      <SecuritiesWorkbenchPageBase />
    </>
  );
}
