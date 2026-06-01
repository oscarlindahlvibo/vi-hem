import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { BANKID_ENABLED } from '../lib/bankid';
import type { Profile } from '../types';

interface AuthContextType {
  user: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  /**
   * Initiates BankID login flow.
   * Returns an error string if BankID is not configured or authentication fails.
   * When BANKID_ENABLED is false this always returns a descriptive error.
   */
  signInWithBankID: () => Promise<{ error: string | null }>;
  /**
   * Links the current user's account to a BankID personal number.
   * Should be called after a successful BankID auth order resolves.
   */
  linkBankID: (personalNumber: string, linkedAt: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Whether the BankID integration is configured and available */
  bankIDAvailable: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signInWithBankID: async () => ({ error: 'BankID är inte aktiverat.' }),
  linkBankID: async () => ({ error: null }),
  signOut: async () => {},
  bankIDAvailable: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    return data as Profile | null;
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        fetchProfile(session.user.id).then(profile => {
          setUser(profile);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        (async () => {
          const profile = await fetchProfile(session.user.id);
          setUser(profile);
        })();
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }

  async function signInWithBankID(): Promise<{ error: string | null }> {
    if (!BANKID_ENABLED) {
      return { error: 'BankID-inloggning är inte aktiverat ännu. Kontakta systemadministratören.' };
    }
    // When BANKID_ENABLED: call Edge Function to initiate BankID auth order,
    // poll for completion, then use the returned personal number to find or
    // create a Supabase auth user and sign in via a custom token.
    return { error: 'BankID är inte konfigurerat.' };
  }

  async function linkBankID(personalNumber: string, linkedAt: string): Promise<{ error: string | null }> {
    if (!user) return { error: 'Inte inloggad.' };
    const { error } = await supabase
      .from('profiles')
      .update({
        bankid_personal_number: personalNumber,
        bankid_linked_at: linkedAt,
        auth_method: user.auth_method === 'password' ? 'both' : 'bankid',
      })
      .eq('id', user.id);
    if (error) return { error: error.message };
    const updated = await fetchProfile(user.id);
    if (updated) setUser(updated);
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInWithBankID, linkBankID, signOut, bankIDAvailable: BANKID_ENABLED }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
