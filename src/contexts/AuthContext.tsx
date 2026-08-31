import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { BANKID_ENABLED } from '../lib/bankid';
import type { Profile } from '../types';

interface AuthContextType {
  user: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  /**
   * Re-fetches the current user's own profile row. The BankID "link my
   * account" flow (useBankIdFlow('link') + vihem-bankid's start_link/collect
   * actions) writes bankid_personal_number server-side once BankID itself
   * has verified it -- this just pulls that change into `user` afterwards,
   * it never accepts a personnummer as input (a self-reported one, not
   * verified by an actual BankID order, would let someone claim to be
   * anybody).
   */
  refreshProfile: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  passwordRecovery: boolean;
  finishPasswordRecovery: () => Promise<void>;
  /** Whether the BankID integration is configured and available */
  bankIDAvailable: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => ({ error: null }),
  refreshProfile: async () => ({ error: null }),
  signOut: async () => {},
  passwordRecovery: false,
  finishPasswordRecovery: async () => {},
  bankIDAvailable: false,
});

const LOCAL_SUPERADMIN_STORAGE_KEY = 'vihem.localSuperadmin';
const LOCAL_USER_STORAGE_KEY = 'vihem.localUserId';
const LOCAL_USERS_KEY = 'vihem.localUsers';
const localSuperadminEmail = import.meta.env.VITE_LOCAL_SUPERADMIN_EMAIL;
const localSuperadminPassword = import.meta.env.VITE_LOCAL_SUPERADMIN_PASSWORD;
const localSuperadminEnabled =
  import.meta.env.DEV &&
  import.meta.env.VITE_ENABLE_LOCAL_SUPERADMIN === 'true' &&
  Boolean(localSuperadminEmail && localSuperadminPassword);

const localSuperadminProfile: Profile = {
  id: 'local-superadmin',
  name: 'Lokal Superadmin',
  email: localSuperadminEmail || 'superadmin@vihem.local',
  phone: '',
  role: 'superadmin',
  active: true,
  is_system_admin: true,
  avatar_url: '',
  organisation_id: null,
  auth_method: 'password',
  bankid_personal_number: null,
  bankid_linked_at: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

function profileFetchErrorMessage(error: any) {
  if (error?.code === 'PGRST205' || String(error?.message || '').includes('schema cache')) {
    return 'Inloggningen lyckades, men VI-HEM:s profiltabeller saknas i Supabase REST-cache. Kör senaste migrationerna och starta om/reloada Supabase REST/PostgREST.';
  }

  return error?.message || 'Kunde inte hämta användarprofilen.';
}

interface LocalTestUser extends Profile {
  password: string;
}

function readLocalUsers(): LocalTestUser[] {
  return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '[]') as LocalTestUser[];
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(
    window.location.pathname === '/reset-password' ||
      window.location.hash.includes('type=recovery')
  );

  async function fetchProfile(userId: string) {
    const { data, error } = await supabase
      .from('vihem_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data as Profile | null;
  }

  useEffect(() => {
    if (localSuperadminEnabled && localStorage.getItem(LOCAL_SUPERADMIN_STORAGE_KEY) === 'true') {
      setUser(localSuperadminProfile);
      setLoading(false);
      return;
    }

    if (localSuperadminEnabled) {
      const localUserId = localStorage.getItem(LOCAL_USER_STORAGE_KEY);
      const localUser = readLocalUsers().find(user => user.id === localUserId && user.active);
      if (localUser) {
        const { password: _password, ...profile } = localUser;
        setUser(profile);
        setLoading(false);
        return;
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        fetchProfile(session.user.id)
          .then(profile => {
            setUser(profile);
            setLoading(false);
          })
          .catch(error => {
            console.error('Error fetching profile:', error);
            setUser(null);
            setLoading(false);
          });
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
        setLoading(false);
      } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        (async () => {
          try {
            const profile = await fetchProfile(session.user.id);
            setUser(profile);
          } catch (error) {
            console.error('Error fetching profile after sign in:', error);
            setUser(null);
          }
        })();
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    if (
      localSuperadminEnabled &&
      email.trim().toLowerCase() === localSuperadminEmail.toLowerCase() &&
      password === localSuperadminPassword
    ) {
      localStorage.setItem(LOCAL_SUPERADMIN_STORAGE_KEY, 'true');
      localStorage.removeItem(LOCAL_USER_STORAGE_KEY);
      setUser(localSuperadminProfile);
      return { error: null };
    }

    if (localSuperadminEnabled) {
      const localUser = readLocalUsers().find(user =>
        user.active &&
        user.email.toLowerCase() === email.trim().toLowerCase() &&
        user.password === password
      );
      if (localUser) {
        const { password: _password, ...profile } = localUser;
        localStorage.removeItem(LOCAL_SUPERADMIN_STORAGE_KEY);
        localStorage.setItem(LOCAL_USER_STORAGE_KEY, localUser.id);
        setUser(profile);
        return { error: null };
      }
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return { error: 'Inloggningen lyckades inte.' };

    try {
      const profile = await fetchProfile(authUser.id);
      if (!profile) {
        await supabase.auth.signOut();
        setUser(null);
        return { error: 'Kontot finns i Supabase Auth men saknar VI-HEM-profil. Kontrollera att profilraden finns i vihem_profiles.' };
      }
      setUser(profile);
    } catch (profileError) {
      await supabase.auth.signOut();
      setUser(null);
      return { error: profileFetchErrorMessage(profileError) };
    }
    return { error: null };
  }

  async function refreshProfile(): Promise<{ error: string | null }> {
    if (!user) return { error: 'Inte inloggad.' };
    try {
      const updated = await fetchProfile(user.id);
      if (updated) setUser(updated);
      return { error: null };
    } catch (error) {
      return { error: profileFetchErrorMessage(error) };
    }
  }

  async function signOut() {
    localStorage.removeItem(LOCAL_SUPERADMIN_STORAGE_KEY);
    localStorage.removeItem(LOCAL_USER_STORAGE_KEY);
    await supabase.auth.signOut();
    setUser(null);
  }

  async function finishPasswordRecovery() {
    setPasswordRecovery(false);
    window.history.replaceState({}, document.title, window.location.origin);
    await signOut();
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, refreshProfile, signOut, passwordRecovery, finishPasswordRecovery, bankIDAvailable: BANKID_ENABLED }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
