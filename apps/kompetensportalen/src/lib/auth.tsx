import React, { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./api";

type AuthState = { session: Session | null; ready: boolean; signOut: () => Promise<void> };
const AuthContext = createContext<AuthState>({ session: null, ready: false, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  return <AuthContext.Provider value={{ session, ready, signOut: async () => { await supabase.auth.signOut(); } }}>{children}</AuthContext.Provider>;
}
