import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Mail, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { AppLogo } from './AppLogo';
import { Button } from './ui';

export function LoginPage() {
  const { signIn, signInWithBankID, bankIDAvailable } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [bankIDLoading, setBankIDLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setLoading(false);
  }

  async function handleBankIDLogin() {
    setError('');
    setBankIDLoading(true);
    const { error } = await signInWithBankID();
    if (error) setError(error);
    setBankIDLoading(false);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setResetSent(false);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl mb-4 shadow-lg overflow-hidden">
            <AppLogo className="w-full h-full" />
          </div>
          <h1 className="text-3xl font-bold text-white">VI-HEM</h1>
          <p className="text-slate-400 mt-2">Fastighetsportalen – logga in för att fortsätta</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* BankID login */}
          <div className="mb-6">
            <button
              type="button"
              onClick={handleBankIDLogin}
              disabled={bankIDLoading}
              className={`w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-semibold text-sm transition-all border-2 ${
                bankIDAvailable
                  ? 'bg-[#193E4F] hover:bg-[#122e3c] text-white border-[#193E4F] hover:border-[#122e3c] cursor-pointer'
                  : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
              title={bankIDAvailable ? 'Logga in med BankID' : 'BankID-integration är inte aktiverad ännu'}
            >
              <BankIDIcon className="w-6 h-6 flex-shrink-0" />
              <span>{bankIDLoading ? 'Öppnar BankID ...' : 'Logga in med BankID'}</span>
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

/** BankID logotype as inline SVG — uses the official BankID color palette */
function BankIDIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="BankID"
    >
      {/* Simplified BankID-style shield icon */}
      <rect width="40" height="40" rx="8" fill="#193E4F" />
      <path
        d="M20 6L8 11v10c0 7.18 5.18 13.89 12 15.56C27.82 34.89 33 28.18 33 21V11L20 6z"
        fill="#71BE00"
        opacity="0.9"
      />
      <path
        d="M16 20.5l3 3 6-6"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
