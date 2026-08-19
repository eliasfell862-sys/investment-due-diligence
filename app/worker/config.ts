export interface WorkerConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  workerInstanceId: string;
  scanCadenceMs: number;
}

type WorkerEnvironment = Record<string, string | undefined>;

function required(env: WorkerEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required worker environment variable: ${name}`);
  return value;
}

export function readWorkerConfig(env: WorkerEnvironment): WorkerConfig {
  return {
    supabaseUrl: required(env, 'SUPABASE_URL'),
    supabaseServiceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    vapidPublicKey: required(env, 'VAPID_PUBLIC_KEY'),
    vapidPrivateKey: required(env, 'VAPID_PRIVATE_KEY'),
    vapidSubject: required(env, 'VAPID_SUBJECT'),
    workerInstanceId: required(env, 'WORKER_INSTANCE_ID'),
    scanCadenceMs: 15_000,
  };
}
