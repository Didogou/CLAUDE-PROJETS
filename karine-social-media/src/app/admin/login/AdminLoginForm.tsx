'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') ?? '/admin';

  const supabase = createClient();
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState<'google' | 'password' | 'magic' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function signInGoogle() {
    setLoading('google');
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(null);
    }
  }

  async function signInPassword(e: FormEvent) {
    e.preventDefault();
    setLoading('password');
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(null);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(redirect);
    router.refresh();
  }

  async function sendMagicLink(e: FormEvent) {
    e.preventDefault();
    setLoading('magic');
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
      },
    });
    setLoading(null);
    if (error) {
      setError(error.message);
      return;
    }
    setInfo(`Email envoyé à ${email}. Ouvre le lien pour te connecter.`);
  }

  return (
    <div className="w-full max-w-md space-y-5 rounded-2xl bg-admin-surface p-7 shadow-xl ring-1 ring-admin-border">
      <header className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">Espace admin</p>
        <h1 className="mt-2 font-script text-4xl text-admin-primary-dark">Karine Diététique</h1>
        <p className="mt-2 text-sm text-admin-ink-soft">
          Réservé aux administratrices et administrateurs autorisés.
        </p>
      </header>

      <button
        type="button"
        onClick={signInGoogle}
        disabled={loading !== null}
        className="flex w-full items-center justify-center gap-3 rounded-full border border-admin-border bg-white px-4 py-2.5 text-sm font-semibold text-admin-ink shadow-sm transition hover:bg-admin-soft/40 disabled:opacity-60"
      >
        <GoogleIcon />
        {loading === 'google' ? 'Connexion…' : 'Continuer avec Google'}
      </button>

      <div className="flex items-center gap-3 text-[0.7rem] uppercase tracking-widest text-admin-ink-soft">
        <span className="h-px flex-1 bg-admin-border" />
        ou
        <span className="h-px flex-1 bg-admin-border" />
      </div>

      <div className="flex rounded-full border border-admin-border bg-white p-0.5 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setMode('password')}
          className={`flex-1 rounded-full py-1.5 transition ${
            mode === 'password' ? 'bg-admin-primary text-white' : 'text-admin-ink-soft'
          }`}
        >
          Mot de passe
        </button>
        <button
          type="button"
          onClick={() => setMode('magic')}
          className={`flex-1 rounded-full py-1.5 transition ${
            mode === 'magic' ? 'bg-admin-primary text-white' : 'text-admin-ink-soft'
          }`}
        >
          Lien magique
        </button>
      </div>

      <form onSubmit={mode === 'password' ? signInPassword : sendMagicLink} className="space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-full border border-admin-border bg-white px-4 py-2 text-sm text-admin-ink outline-none focus:border-admin-primary"
        />
        {mode === 'password' && (
          <input
            type="password"
            required
            minLength={6}
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-full border border-admin-border bg-white px-4 py-2 text-sm text-admin-ink outline-none focus:border-admin-primary"
          />
        )}
        <button
          type="submit"
          disabled={loading !== null}
          className="w-full rounded-full bg-admin-primary py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-60"
        >
          {loading === 'password'
            ? 'Connexion…'
            : loading === 'magic'
              ? 'Envoi…'
              : mode === 'password'
                ? 'Se connecter'
                : 'Recevoir le lien'}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {info && (
        <div className="rounded-lg border border-sage/40 bg-sage/10 px-3 py-2 text-sm text-admin-ink">{info}</div>
      )}

      <p className="text-center text-[0.7rem] text-admin-ink-soft">
        Pas un admin ? Demande à Karine de t&apos;ajouter à la liste d&apos;accès.
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.6 5A20 20 0 0 0 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2A19.9 19.9 0 0 0 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
