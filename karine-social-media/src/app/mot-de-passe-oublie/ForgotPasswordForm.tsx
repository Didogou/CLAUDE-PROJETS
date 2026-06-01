'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, Heart, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { BrandHeader } from '@/components/brand/BrandHeader';
import { AuthFooter } from '@/components/brand/AuthFooter';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/nouveau-mot-de-passe`,
      });
      if (error) throw error;
      setSuccess(true);
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
                Mot de passe oublié
              </h1>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-ink-soft">
                On t&apos;envoie un lien pour le réinitialiser
                <Heart className="h-3.5 w-3.5 fill-coral-soft text-coral" />
              </p>
            </header>

            {success ? (
              <div className="space-y-4 text-center">
                <div className="rounded-2xl border border-sage/40 bg-sage/10 px-4 py-4 text-sm text-ink">
                  ✅ E-mail envoyé à <span className="font-semibold">{email}</span>.
                  Clique sur le lien dans le message pour choisir un nouveau mot de
                  passe.
                </div>
                <p className="text-xs text-ink-soft">
                  Si tu ne reçois rien dans 2-3 min, vérifie tes spams.
                </p>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Retour à la connexion
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="relative block">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-coral" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Adresse e-mail"
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
                  {loading ? 'Envoi…' : 'M’envoyer le lien'}
                </button>

                <Link
                  href="/login"
                  className="block text-center text-xs font-semibold text-coral hover:text-coral-dark hover:underline"
                >
                  ← Retour à la connexion
                </Link>
              </form>
            )}
          </section>
        </div>
      </div>

      <AuthFooter />

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
