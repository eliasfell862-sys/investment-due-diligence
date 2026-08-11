import { useOptionalAuth } from '../auth/AuthProvider';
import { SignalInbox as LocalSignalInbox } from './SignalInboxBase';
import { CloudSignalInbox } from './cloud/CloudSignalInbox';

export function SignalInboxModeSwitch() {
  const auth = useOptionalAuth();
  const cloudMode = Boolean(auth?.cloudEnabled && auth.user);
  return cloudMode ? <CloudSignalInbox /> : <LocalSignalInbox />;
}
