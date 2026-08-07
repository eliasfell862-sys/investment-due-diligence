import { readCloudEnvironment } from '../../infrastructure/cloud/cloud-environment';
import { CloudSignalInbox } from './cloud/CloudSignalInbox';
import { SignalInbox as LocalSignalInbox } from './SignalInboxBase';

export function SignalInboxModeSwitch() {
  return readCloudEnvironment(import.meta.env) ? <CloudSignalInbox /> : <LocalSignalInbox />;
}
