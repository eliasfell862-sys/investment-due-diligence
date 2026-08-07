import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readAuthEnvironment } from './cloud-environment';

let browserClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const environment = readAuthEnvironment(import.meta.env);
  if (!environment) throw new Error('Authentication is not configured');

  browserClient = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );
  return browserClient;
}
