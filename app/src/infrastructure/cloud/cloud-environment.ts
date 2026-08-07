export interface CloudEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  vapidPublicKey: string;
}

export function readCloudEnvironment(
  env: Record<string, string | boolean | undefined>,
): CloudEnvironment | null {
  const supabaseUrl = String(env.VITE_SUPABASE_URL ?? '').trim();
  const supabaseAnonKey = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  const vapidPublicKey = String(env.VITE_VAPID_PUBLIC_KEY ?? '').trim();

  if (!supabaseUrl && !supabaseAnonKey && !vapidPublicKey) return null;
  if (!supabaseUrl || !supabaseAnonKey || !vapidPublicKey) {
    throw new Error('Cloud monitoring environment is incomplete');
  }

  return { supabaseUrl, supabaseAnonKey, vapidPublicKey };
}
