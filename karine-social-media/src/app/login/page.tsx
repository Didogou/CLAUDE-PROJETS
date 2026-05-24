'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Mode = 'password' | 'magic';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') ?? '/';

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (isSignUp) {
      setMessage('Compte créé ! Vous pouvez vous connecter.');
      setIsSignUp(false);
    } else {
      router.push(redirect);
      router.refresh();
    }
  }

  async function handleMagicLinkSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
      },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(`Email envoyé à ${email}. Cliquez sur le lien pour vous connecter.`);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-3xl font-bold text-center text-[#2E7D5E]">Connexion</h1>

        <div className="flex border border-gray-200 rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => setMode('password')}
            className={`flex-1 py-2 text-sm transition ${
              mode === 'password'
                ? 'bg-[#2E7D5E] text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Email + mot de passe
          </button>
          <button
            type="button"
            onClick={() => setMode('magic')}
            className={`flex-1 py-2 text-sm transition ${
              mode === 'magic'
                ? 'bg-[#2E7D5E] text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Lien magique
          </button>
        </div>

        {mode === 'password' ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2E7D5E]"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2E7D5E]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-[#2E7D5E] text-white rounded-md hover:bg-[#1f5a44] disabled:opacity-50 transition"
            >
              {loading ? '...' : isSignUp ? 'Créer un compte' : 'Se connecter'}
            </button>
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="w-full text-sm text-[#2E7D5E] hover:underline"
            >
              {isSignUp ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? Créer un compte'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMagicLinkSubmit} className="space-y-4">
            <div>
              <label htmlFor="email-magic" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email-magic"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2E7D5E]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-[#2E7D5E] text-white rounded-md hover:bg-[#1f5a44] disabled:opacity-50 transition"
            >
              {loading ? '...' : 'Recevoir le lien'}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Vous recevrez un email avec un lien pour vous connecter sans mot de passe.
            </p>
          </form>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
            {error}
          </div>
        )}
        {message && (
          <div className="p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-md">
            {message}
          </div>
        )}
      </div>
    </main>
  );
}
