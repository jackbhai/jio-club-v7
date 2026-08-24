import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export const appBase = () => window.location.origin + window.location.pathname;

// RPC wrapper with friendly errors
export async function rpc(fn, params = {}) {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message || 'Server error');
  return data;
}
