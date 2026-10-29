// Runtime configuration, loaded from /config.js (see public/config.example.js).
// Only PUBLIC values belong here: the project URL and the anon (publishable) key.
const raw = (typeof window !== 'undefined' && window.__RESUMED_CONFIG__) || {};
export const config = {
  supabaseUrl: String(raw.supabaseUrl || '').replace(/\/+$/, ''),
  supabaseAnonKey: String(raw.supabaseAnonKey || ''),
};
export const isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey)
  && !/YOUR-PROJECT-REF|YOUR-ANON/.test(config.supabaseUrl + config.supabaseAnonKey);
