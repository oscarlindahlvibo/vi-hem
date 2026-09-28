import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, X } from 'lucide-react';
import { AppLogo } from './AppLogo';
import { Button } from './ui';
import { passwordResetRedirectUrl } from '../lib/authUrls';
import { initiateBankIDAuth } from '../lib/bankid';
import { useBankIdFlow } from '../hooks/useBankIdFlow';
import { isMobileBrowser } from '../lib/utils';

export function LoginPage() {
  const { signIn, bankIDAvailable } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [bankIdSigningIn, setBankIdSigningIn] = useState(false);
  const verifiedBankIdTokenRef = useRef<string | null>(null);
  const bankId = useBankIdFlow('auth');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setLoading(false);
  }

  function handleBankIDLogin(sameDevice?: boolean) {
    setError('');
    bankId.start(() => initiateBankIDAuth({ environment: 'test', edgeFunctionUrl: '' }, ''), sameDevice !== undefined ? { sameDevice } : undefined);
  }

  // Finish the BankID login inside this Supabase client. Navigating to the
  // generated magic-link URL makes iOS open/log in the public website,
  // leaving the installed Capacitor app without a session. verifyOtp()
  // stores the normal refreshable session in this app's localStorage and
  // AuthContext's onAuthStateChange then takes the user to the app itself.
  useEffect(() => {
    if (bankId.status !== 'complete') return;
    let tokenHash = bankId.result?.token_hash || '';

    // Backwards compatibility while an older vihem-bankid Edge Function is
    // still deployed: Supabase's generated action_link contains the same
    // hashed one-time token in its `token` query parameter.
    if (!tokenHash && bankId.result?.magic_link) {
      try { tokenHash = new URL(bankId.result.magic_link).searchParams.get('token') || ''; } catch { tokenHash = ''; }
    }

    if (!tokenHash) {
      setError('BankID godkändes, men kontot saknar en användbar e-postadress.');
      return;
    }

    if (verifiedBankIdTokenRef.current === tokenHash) return;
    verifiedBankIdTokenRef.current = tokenHash;
    setBankIdSigningIn(true);
    setError('');

    void (async () => {
      try {
        const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
        if (verifyError) throw verifyError;
      } catch (verifyError) {
        verifiedBankIdTokenRef.current = null;
        const message = verifyError instanceof Error ? verifyError.message : 'Okänt fel';
        setError(`BankID godkändes, men appinloggningen misslyckades: ${message}`);
      } finally {
        setBankIdSigningIn(false);
      }
    })();
  }, [bankId.status, bankId.result]);

  useEffect(() => {
    if (bankId.error) setError(bankId.error);
  }, [bankId.error]);

  const bankIdBusy = bankIdSigningIn || bankId.status === 'starting' || bankId.status === 'redirecting' || bankId.status === 'pending';

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setResetSent(false);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: passwordResetRedirectUrl(),
    });
    if (error) {
      setError(
        error.message.toLowerCase().includes('sending')
          ? 'Kunde inte skicka återställningsmejl. Kontrollera att e-postservern är konfigurerad.'
          : error.message
      );
    } else {
      setResetSent(true);
    }
    setLoading(false);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-12">
      <LoginBackground />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl mb-4 shadow-lg shadow-black/30 overflow-hidden">
            <AppLogo className="w-full h-full" />
          </div>
          <h1 className="text-3xl font-bold text-white drop-shadow-sm">Välkommen hem</h1>
          <p className="text-slate-200/90 mt-2">VI-HEM Fastighetsportalen – logga in för att fortsätta</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl shadow-black/40 p-8">
          {/* BankID login */}
          <div className="mb-6">
            {bankIdBusy ? (
              <div className="rounded-xl border-2 border-[#193E4F]/20 bg-slate-50 p-5 text-center">
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[#193E4F]">
                    <BankIDLogo className="h-5 w-auto flex-shrink-0" /> BankID
                  </span>
                  <button type="button" onClick={bankId.reset} className="text-slate-400 hover:text-slate-600" title="Avbryt">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {bankId.qrImage && (
                  <img src={bankId.qrImage} alt="QR-kod för BankID" className="mx-auto mb-3 h-44 w-44 rounded-lg border border-slate-200 bg-white p-2" />
                )}
                {bankId.launchUrl ? (
                  <a
                    href={bankId.launchUrl}
                    onClick={() => bankId.confirmLaunched()}
                    className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#193E4F] px-4 py-3 text-sm font-semibold text-white hover:bg-[#122e3c]"
                  >
                    <BankIDLogo variant="white" className="h-5 w-auto flex-shrink-0" /> Öppna BankID-appen
                  </a>
                ) : (
                  <p className="text-sm text-slate-600">{bankId.message || 'Startar BankID...'}</p>
                )}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleBankIDLogin()}
                  className={`w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-semibold text-sm transition-all border-2 ${
                    bankIDAvailable
                      ? 'bg-[#193E4F] hover:bg-[#122e3c] text-white border-[#193E4F] hover:border-[#122e3c] cursor-pointer'
                      : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                  }`}
                  title={bankIDAvailable ? 'Logga in med BankID' : 'BankID-integration är inte aktiverad ännu'}
                >
                  <BankIDLogo variant={bankIDAvailable ? 'white' : 'default'} className="h-7 w-auto flex-shrink-0" />
                  <span>Logga in med BankID</span>
                  {!bankIDAvailable && (
                    <span className="ml-auto text-xs bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full font-normal">
                      Kommer snart
                    </span>
                  )}
                </button>
                {!bankIDAvailable && (
                  <p className="text-xs text-slate-400 text-center mt-2">
                    BankID-inloggning aktiveras när integrationen är konfigurerad.
                  </p>
                )}
                {bankIDAvailable && !isMobileBrowser() && (
                  <button
                    type="button"
                    onClick={() => handleBankIDLogin(true)}
                    className="w-full text-center text-xs text-slate-500 hover:text-slate-700 mt-2"
                  >
                    Har du BankID på den här enheten? Logga in utan att skanna QR-kod
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-medium">eller e-post och lösenord</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {forgotMode ? (
            <form onSubmit={handleForgotPassword} className="space-y-5">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">E-postadress</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="din@email.se"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              {resetSent && (
                <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm">
                  Om e-postadressen finns skickas en länk för att välja nytt lösenord.
                </div>
              )}

              <Button type="submit" loading={loading} className="w-full" size="lg">
                Skicka återställningslänk
              </Button>
              <button
                type="button"
                onClick={() => {
                  setForgotMode(false);
                  setError('');
                  setResetSent(false);
                }}
                className="w-full text-sm text-slate-500 hover:text-slate-700"
              >
                Tillbaka till inloggning
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">E-postadress</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="din@email.se"
                  required
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Lösenord</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-10 pr-10 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Logga in
            </Button>
            <button
              type="button"
              onClick={() => {
                setForgotMode(true);
                setError('');
              }}
              className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Glömt lösenord?
            </button>
          </form>
          )}

          <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>BankID-inloggning krypteras med TLS 1.3</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginBackground() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <img
        src="/images/login-property-bg.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-0 bg-slate-950/45" />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950/70 via-slate-900/25 to-amber-900/30" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-slate-950/65 to-transparent" />
    </div>
  );
}

function BankIDLogo({ className, variant = 'default' }: { className?: string; variant?: 'default' | 'white' }) {
  return (
    <img
      src={variant === 'white' ? '/icons/bankid-logo-white.svg' : '/icons/bankid-logo.svg'}
      alt="BankID"
      className={className}
      draggable={false}
    />
  );
}
