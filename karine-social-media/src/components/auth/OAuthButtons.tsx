'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Provider = 'google' | 'facebook';

const PROVIDER_LABELS: Record<Provider, string> = {
  google: 'Continuer avec Google',
  facebook: 'Continuer avec Facebook',
};

function GoogleLogo() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.4c-.23 1.41-1.65 4.14-5.4 4.14a6.24 6.24 0 0 1 0-12.48c1.95 0 3.26.83 4.01 1.54l2.74-2.64C16.96 2.96 14.69 2 12 2 6.48 2 2 6.48 2 12s4.48 10 10 10c5.76 0 9.58-4.04 9.58-9.74 0-.65-.07-1.15-.17-1.66H12z"
      />
      <path
        fill="#4285F4"
        d="M21.58 12.26c0-.65-.07-1.15-.17-1.66H12v3.9h5.4c-.11.68-.7 1.7-2.01 2.39l-.02.14 2.91 2.26.2.02c1.85-1.71 2.92-4.22 2.92-7.05z"
      />
      <path
        fill="#FBBC05"
        d="M6.59 14.32a6.21 6.21 0 0 1 0-4.64L6.55 9.5 3.6 7.22l-.1.05A10 10 0 0 0 2 12c0 1.61.39 3.13 1.08 4.48l3.51-2.16z"
      />
      <path
        fill="#34A853"
        d="M12 5.76c1.95 0 3.26.83 4.01 1.54l2.93-2.86A9.6 9.6 0 0 0 12 2 10 10 0 0 0 3.5 7.22l3.09 2.39A6 6 0 0 1 12 5.76z"
      />
    </svg>
  );
}

function FacebookLogo() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.23 2.69.23v2.97h-1.52c-1.49 0-1.96.93-1.96 1.89v2.27h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"
      />
      <path
        fill="#fff"
        d="m16.67 15.56.53-3.49h-3.33V9.8c0-.96.47-1.89 1.96-1.89h1.52V4.94s-1.38-.23-2.69-.23c-2.74 0-4.53 1.67-4.53 4.69v2.66H7.08v3.49h3.05V24c.61.1 1.23.15 1.87.15s1.26-.05 1.87-.15v-8.44h2.8z"
      />
    </svg>
  );
}

const LOGOS: Record<Provider, () => React.ReactElement> = {
  google: GoogleLogo,
  facebook: FacebookLogo,
};

export function OAuthButton({
  provider,
  redirect = '/',
}: {
  provider: Provider;
  redirect?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Logo = LOGOS[provider];

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
        },
      });
      if (error) throw error;
      // signInWithOAuth redirige automatiquement vers le provider, donc on n'arrive
      // jamais ici en cas de succès.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2.5 rounded-full border border-coral-soft bg-white px-3 py-2.5 text-sm font-semibold text-ink shadow-sm transition hover:bg-coral-soft/20 disabled:opacity-50 sm:gap-3 sm:px-4 sm:py-3"
      >
        <Logo />
        <span className="truncate">
          {loading ? 'Redirection…' : PROVIDER_LABELS[provider]}
        </span>
      </button>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </>
  );
}
