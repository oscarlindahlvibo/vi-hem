import React, { useId, useRef, useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { AppLogo } from './AppLogo';
import { Button } from './ui';

export function ResetPasswordPage() {
  const { finishPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const lock = useRef(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    setError('');

    if (password.length < 8) {
      setError('Lösenordet måste vara minst 8 tecken.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Lösenorden matchar inte.');
      return;
    }

    lock.current = true; setLoading(true);
    try {
      const result = await supabase.auth.updateUser({password});
      if (result.error) { setError('Lösenordet kunde inte uppdateras. Öppna en aktuell återställningslänk och försök igen.'); return; }
      setPassword(''); setConfirmPassword(''); setSuccess(true);
    } catch { setError('Det gick inte att ansluta. Försök igen när uppkopplingen är tillbaka.'); }
    finally { lock.current = false; setLoading(false); }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl mb-4 shadow-lg overflow-hidden">
            <AppLogo className="w-full h-full" />
          </div>
          <h1 className="text-3xl font-bold text-white">VI-HEM</h1>
          <p className="text-slate-400 mt-2">Välj ett nytt lösenord</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-5 sm:p-8">
          {success ? (
            <div className="space-y-5">
              <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm">
                Lösenordet är uppdaterat. Logga in igen med ditt nya lösenord.
              </div>
              <Button className="w-full" size="lg" onClick={finishPasswordRecovery}>
                Till inloggning
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5"><div><h2 className="text-xl font-semibold tracking-tight text-slate-900">Skydda ditt konto</h2><p id="password-help" className="mt-2 text-sm leading-relaxed text-slate-500">Välj minst åtta tecken. Använd gärna ett långt lösenord som du inte använder någon annanstans.</p></div>
              <PasswordInput
                label="Nytt lösenord"
                value={password}
                showPassword={showPassword}
                onChange={setPassword}
                onToggleShow={() => setShowPassword((current) => !current)}
              />
              <PasswordInput
                label="Bekräfta lösenord"
                value={confirmPassword}
                showPassword={showPassword}
                onChange={setConfirmPassword}
                onToggleShow={() => setShowPassword((current) => !current)}
              />

              {error && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <Button type="submit" loading={loading} className="w-full" size="lg">
                Uppdatera lösenord
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function PasswordInput({
  label,
  value,
  showPassword,
  onChange,
  onToggleShow,
}: {
  label: string;
  value: string;
  showPassword: boolean;
  onChange: (value: string) => void;
  onToggleShow: () => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-slate-700 block mb-1.5">{label}</label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          id={id} autoComplete="new-password" minLength={8} aria-describedby="password-help" type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          className="w-full pl-10 pr-10 py-2.5 border border-slate-300 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
        />
        <button type="button" onClick={onToggleShow} aria-label={showPassword ? 'Dölj lösenord' : 'Visa lösenord'} aria-pressed={showPassword} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500">
          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
