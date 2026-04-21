// ============================================================
// Supabase Configuration — Mioshie College
// Replace these values with your Supabase project credentials
// Get them from: Project Settings > API
// ============================================================
import { createClient } from '@supabase/supabase-js';

const SUPABASE_CONFIG = {
  url: 'https://succhmnbajvbpmoqrktq.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1Y2NobW5iYWp2YnBtb3Fya3RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjY3MDgsImV4cCI6MjA5MjA0MjcwOH0.humCcLYpnnnapkLtLOeb9ZVo5EZWoWw6ItNo0WVY3DY'
};

// Shared singleton — import this instead of calling createClient() directly.
// This prevents "Multiple GoTrueClient instances" warnings.
export const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

// Named exports for Edge Function fetch calls (anon key is safe to expose — it's public by design)
export const SUPABASE_URL = SUPABASE_CONFIG.url;
export const SUPABASE_ANON_KEY = SUPABASE_CONFIG.anonKey;

export default SUPABASE_CONFIG;
