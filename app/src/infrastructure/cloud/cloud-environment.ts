export interface AuthEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface PushEnvironment {
  vapidPublicKey: string;
}

export interface CloudEnvironment extends AuthEnvironment, PushEnvironment {}

type BrowserEnvironment = Record<string, string | boolean | undefined>;

function value(env: BrowserEnvironment, key: string): string {
  return String(env[key] ?? '').trim();
}

export function readAuthEnvironment(env: BrowserEnvironment): AuthEnvironment | null {
  const supabaseUrl = value(env, 'VITE_SUPABASE_URL');
  const supabaseAnonKey = value(env, 'VITE_SUPABASE_ANON_KEY');

  if (!supabaseUrl && !supabaseAnonKey) return null;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Authentication environment is incomplete');
  }

  return { supabaseUrl, supabaseAnonKey };
}

export function readPushEnvironment(env: BrowserEnvironment): PushEnvironment | null {
  const vapidPublicKey = value(env, 'VITE_VAPID_PUBLIC_KEY');
  return vapidPublicKey ? { vapidPublicKey } : null;
}

export function readCloudEnvironment(env: BrowserEnvironment): CloudEnvironment | null {
  const authentication = readAuthEnvironment(env);
  const push = readPushEnvironment(env);
  if (!authentication || !push) return null;
  return { ...authentication, ...push };
}

export function assertProductionAuthEnvironment(env: BrowserEnvironment): AuthEnvironment {
  const exposedServiceRole = Object.entries(env).some(([key, raw]) =>
    key.startsWith('VITE_')
    && key.toUpperCase().includes('SERVICE_ROLE')
    && String(raw ?? '').trim().length > 0);
  if (exposedServiceRole) {
    throw new Error('Service role credentials must not be exposed to the browser');
  }

  const authentication = readAuthEnvironment(env);
  if (!authentication) throw new Error('Production authentication environment is required');

  let url: URL;
  try {
    url = new URL(authentication.supabaseUrl);
  } catch {
    throw new Error('Production Supabase URL must be a valid URL');
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
  ) {
    throw new Error('Production Supabase URL must not use a loopback host');
  }

  return authentication;
}
