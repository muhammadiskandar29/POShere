import { createClient } from '@supabase/supabase-js';

// Ambil credential dari LocalStorage (jika disetting dinamis dari UI) atau dari Vite Env
export function getSupabaseConfig() {
  const customUrl = localStorage.getItem('poshere_supabase_url');
  const customKey = localStorage.getItem('poshere_supabase_key');

  const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  const url = (customUrl && customUrl.trim()) ? customUrl.trim() : envUrl.trim();
  const key = (customKey && customKey.trim()) ? customKey.trim() : envKey.trim();

  const isConfigured = Boolean(
    url && 
    key && 
    !url.includes('your-project') && 
    !key.includes('your-anon-key')
  );

  return { url, key, isConfigured };
}

let supabaseInstance = null;

export function getSupabase() {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured) return null;

  if (!supabaseInstance || supabaseInstance.supabaseUrl !== url) {
    try {
      supabaseInstance = createClient(url, key);
    } catch (e) {
      console.error('Supabase init error:', e);
      return null;
    }
  }
  return supabaseInstance;
}

export function saveSupabaseConfig(url, key) {
  if (url) localStorage.setItem('poshere_supabase_url', url.trim());
  if (key) localStorage.setItem('poshere_supabase_key', key.trim());
  supabaseInstance = null; // force re-create
}
