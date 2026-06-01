'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Heart, KeyRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { BrandHeader } from '@/components/brand/BrandHeader';

export default function NewPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  // Quand l'utilisateur clique sur le lien reçu par email, Supabase crée une
  // session temporaire. Si pas de session ici, c'est que le lien est invalide
  // / expiré ou que l'utilisateur a atterri là par hasard.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
    });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    if (password.length < 6) {
      setError('Mot de passe trop court (6 caractères minimum).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => {
        router.push('/');
        router.refresh();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-x-hidden">
      <BrandHeader />

      <div className="flex flex-1 items-center justify-center px-3 py-5 sm:px-5 sm:py-6">
        <div className="w-full max-w-md">
          <section className="rounded-3xl border border-coral-soft/40 bg-white/85 px-4 py-6 shadow-[0_18px_40px_-22px_rgba(226,120,141,0.55)] backdrop-blur-sm sm:px-7 sm:py-7">
            <header className="mb-5 text-center">
              <h1 className="font-script text-4xl text-coral-dark sm:text-5xl">
                Nouveau mot de passe
              </h1>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-ink-soft">
                Choisis-en un que tu retiendras
                <Heart className="h-3.5 w-3.5 fill-coral-soft text-coral" />
              </p>
            </header>

            {hasSession === false && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                Lien invalide ou expiré. Redemande un lien depuis « Mot de passe
                oublié ».
              </div>
            )}

            {success ? (
              <div className="rounded-2xl border border-sage/40 bg-sage/10 px-4 py-4 text-center text-sm text-ink">
                ✅ Mot de passe modifié ! Redirection…
              </div>
            ) : (
              hasSession !== false && (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <label className="relative block">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-coral" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Nouveau mot de passe"
                      className="input-pill pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((s) => !s)}
                      aria-label="Afficher/masquer"
                      className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-ink-soft transition hover:bg-coral-soft/40 hover:text-coral-dark"
                    >
                      {showPass ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </label>

                  <label className="relative block">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-coral" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Confirme le mot de passe"
                      className="input-pill"
                    />
                  </label>

                  {error && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-full bg-coral py-3 text-sm font-bold text-white shadow-[0_6px_18px_-8px_rgba(226,120,141,0.8)] transition hover:bg-coral-dark disabled:opacity-50"
                  >
                    {loading ? 'Mise à jour…' : 'Enregistrer'}
                  </button>
                </form>
              )
            )}
          </section>
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
