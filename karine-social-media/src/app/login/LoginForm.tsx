'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Heart, KeyRound, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { authErrorFr } from '@/lib/auth-error-fr';
import { AuthHeader } from '@/components/brand/AuthHeader';
import { OAuthButton } from '@/components/auth/OAuthButtons';
import { safeNextPath } from '@/lib/safe-redirect';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Anti open redirect : safeNextPath rejette les URLs absolues etc.
  const redirect = safeNextPath(
    searchParams.get('next') ?? searchParams.get('redirect'),
    '/',
  );
  const reason = searchParams.get('reason');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      // Hard navigation au lieu de router.push :
      // sur Android, Chrome affiche l'invite "enregistrer le mot de passe"
      // au submit ; un router.push (nav client SPA) garde la même page
      // technique et l'invite se redéclenche à chaque ré-interaction.
      // window.location.assign provoque un vrai changement de doc → l'invite
      // se ferme proprement et la session refresh est complète.
      window.location.assign(redirect);
    } catch (err) {
      // Traduit les messages Supabase ("Invalid login credentials" etc.)
      // en français lisible pour l'utilisatrice.
      setError(authErrorFr(err instanceof Error ? err.message : ''));
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-x-hidden">
      <AuthHeader />

      <div className="flex flex-1 items-center justify-center px-3 py-5 sm:px-5 sm:py-6">
        <div className="w-full max-w-md">
          {reason === 'forbidden' && (
            <div className="mb-4 rounded-2xl border border-coral-soft bg-white/80 px-4 py-3 text-center text-sm text-coral-dark shadow-sm">
              Connecte-toi pour accéder à cette page.
            </div>
          )}

          <section className="rounded-3xl border border-coral-soft/40 bg-white/85 px-4 py-6 shadow-[0_18px_40px_-22px_rgba(226,120,141,0.55)] backdrop-blur-sm sm:px-7 sm:py-7">
            <header className="mb-5 text-center">
              <h1 className="font-script text-4xl text-coral-dark sm:text-5xl">
                Connexion
              </h1>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-ink-soft">
                Ravie de te retrouver&nbsp;!
                <Heart className="h-3.5 w-3.5 fill-coral-soft text-coral" />
              </p>
            </header>

            <form onSubmit={handleSubmit} className="space-y-3">
              <Field icon={Mail} label="Adresse e-mail">
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Adresse e-mail"
                  className="input-pill"
                />
              </Field>

              <Field icon={KeyRound} label="Mot de passe">
                <input
                  id="login-password"
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mot de passe"
                  className="input-pill pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  aria-label={
                    showPass ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
                  }
                  className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-ink-soft transition hover:bg-coral-soft/40 hover:text-coral-dark"
                >
                  {showPass ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </Field>

              <div className="flex justify-end">
                <Link
                  href="/mot-de-passe-oublie"
                  className="text-xs font-semibold text-coral hover:text-coral-dark hover:underline"
                >
                  Mot de passe oublié ?
                </Link>
              </div>

              {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 w-full rounded-full bg-coral py-3 text-sm font-bold text-white shadow-[0_6px_18px_-8px_rgba(226,120,141,0.8)] transition hover:bg-coral-dark disabled:opacity-50"
              >
                {loading ? 'Connexion…' : 'Se connecter'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">
              <span className="h-px flex-1 bg-coral-soft/60" />
              <span>ou</span>
              <span className="h-px flex-1 bg-coral-soft/60" />
            </div>

            <div className="space-y-3">
              <OAuthButton provider="google" redirect={redirect} />
              <OAuthButton provider="facebook" redirect={redirect} />
            </div>
          </section>

          {/* CTA inscription — version "abonnement" : on monte d'un cran
              en hiérarchie (lien petit gris → CTA pleine largeur bouton-like)
              parce qu'à ce stade, créer un compte est l'action la plus
              probable pour les visiteuses arrivées sur ce mur. */}
          <div className="mt-6 text-center">
            <p className="mb-2 text-sm font-semibold text-ink-soft">
              Pas encore de compte&nbsp;?
            </p>
            <Link
              href={`/signup${redirect !== '/' ? `?next=${encodeURIComponent(redirect)}` : ''}`}
              className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-coral bg-white px-6 py-3 text-base font-bold text-coral shadow-sm transition hover:bg-coral-soft/30 hover:shadow active:scale-[0.98] sm:text-lg"
            >
              Créer mon compte 🌸
            </Link>
          </div>
        </div>
      </div>


      <style>{`
        .input-pill {
          width: 100%;
          padding: 0.75rem 1rem 0.75rem 2.75rem;
          border-radius: 9999px;
          border: 1px solid rgba(226, 120, 141, 0.35);
          background: #fff;
          font-size: 0.875rem;
          color: #4b4248;
          outline: none;
          transition: border-color 150ms ease;
        }
        .input-pill::placeholder {
          color: #b59ea4;
        }
        .input-pill:focus {
          border-color: #e2788d;
          box-shadow: 0 0 0 3px rgba(226, 120, 141, 0.15);
        }
      `}</style>
    </main>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="relative block" aria-label={label}>
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-coral" />
      {children}
    </label>
  );
}
