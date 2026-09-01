import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// createClient() below throws synchronously if either value is missing, and
// this module is imported at the top of the whole app (main.tsx -> App.tsx
// -> AuthContext.tsx), so that throw otherwise surfaces as a generic
// "supabaseUrl is required" with no indication of WHY the build has no
// config -- replace it with a message that actually points at the cause
// (see ci_post_clone.sh's release:check step, which is meant to catch this
// before it ever reaches a built app).
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY saknas i detta bygge. Om detta är ett CI-bygge: kontrollera miljövariablerna i Xcode Cloud-workflowets inställningar.'
  );
}

export { supabaseAnonKey, supabaseUrl };
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});
