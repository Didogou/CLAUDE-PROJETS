'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Eye,
  EyeOff,
  Heart,
  HeartHandshake,
  KeyRound,
  Mail,
  User,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { BrandHeader } from '@/components/brand/BrandHeader';

export default function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('next') ?? '/';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isPatient, setIsPatient] = useState(false);
  const [patientMessage, setPatientMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const supabase = createClient();
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const { error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });

      if (signUpErr && /already|registered/i.test(signUpErr.message)) {
        // Compte existe déjà → on tente login
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr) {
          throw new Error(
            'Un compte existe déjà avec cet email. Mot de passe incorrect ?',
          );
        }
      } else if (signUpErr) {
        throw new Error(signUpErr.message);
      }

      // Si la confirmation email Supabase est désactivée, l'utilisateur est
      // immédiatement connecté. On crée la demande patiente si cochée.
      if (isPatient) {
        const res = await fetch('/api/patient-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: patientMessage.trim() }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          // On ne bloque pas le signup si la demande échoue, on prévient juste
          console.warn('[patient-request] échec', j?.error);
        }
        setSuccess(
          'Compte créé ! Ta demande d\'accès patiente a été envoyée à Karine. Tu peux explorer en attendant.',
        );
        setTimeout(() => {
          router.push(redirect);
          router.refresh();
        }, 1800);
        return;
      }

      router.push(redirect);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-x-hidden">
      <BrandHeader />

      <div className="flex flex-1 items-start justify-center px-3 py-5 sm:items-center sm:px-5 sm:py-6">
        <div className="w-full max-w-md">
          <section className="rounded-3xl border border-coral-soft/40 bg-white/85 px-4 py-6 shadow-[0_18px_40px_-22px_rgba(226,120,141,0.55)] backdrop-blur-sm sm:px-7 sm:py-7">
            <header className="mb-5 text-center">
              <h1 className="font-script text-4xl text-coral-dark sm:text-5xl">
                Créer mon compte
              </h1>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-ink-soft">
                Bienvenue dans la famille
                <Heart className="h-3.5 w-3.5 fill-coral-soft text-coral" />
              </p>
            </header>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field icon={User}>
                  <input
                    type="text"
                    required
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Prénom"
                    className="input-pill"
                  />
                </Field>
                <Field icon={User}>
                  <input
                    type="text"
                    required
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Nom"
                    className="input-pill"
                  />
                </Field>
              </div>

              <Field icon={Mail}>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Adresse e-mail"
                  className="input-pill"
                />
              </Field>

              <Field icon={KeyRound}>
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mot de passe (6 caractères min)"
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

              {/* Checkbox patiente */}
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-coral-soft/60 bg-coral-soft/15 px-4 py-3 text-sm transition hover:bg-coral-soft/25">
                <input
                  type="checkbox"
                  checked={isPatient}
                  onChange={(e) => setIsPatient(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-coral"
                />
                <span className="flex-1">
                  <span className="flex items-center gap-1.5 font-semibold text-coral-dark">
                    <HeartHandshake className="h-4 w-4" />
                    Je suis patiente de Karine
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    Karine te validera un accès gratuit de 6 semaines.
                  </span>
                </span>
              </label>

              {isPatient && (
                <textarea
                  value={patientMessage}
                  onChange={(e) => setPatientMessage(e.target.value)}
                  rows={3}
                  placeholder="Message à Karine (ex. consultation du 12 mai à 14 h)"
                  className="w-full resize-y rounded-2xl border border-coral-soft/40 bg-white px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft/60 focus:border-coral focus:shadow-[0_0_0_3px_rgba(226,120,141,0.15)]"
                />
              )}

              {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              {success && (
                <p className="rounded-xl border border-sage/40 bg-sage/10 px-3 py-2 text-sm text-ink">
                  {success}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 w-full rounded-full bg-coral py-3 text-sm font-bold text-white shadow-[0_6px_18px_-8px_rgba(226,120,141,0.8)] transition hover:bg-coral-dark disabled:opacity-50"
              >
                {loading ? 'Création…' : 'Créer mon compte'}
              </button>
            </form>
          </section>

          <p className="mt-6 text-center text-sm text-ink-soft">
            Déjà un compte ?{' '}
            <Link
              href={`/login${redirect !== '/' ? `?next=${encodeURIComponent(redirect)}` : ''}`}
              className="font-semibold text-coral hover:text-coral-dark hover:underline"
            >
              Se connecter
            </Link>
          </p>
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
  children,
}: {
  icon: typeof Mail;
  children: React.ReactNode;
}) {
  return (
    <label className="relative block">
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-coral" />
      {children}
    </label>
  );
}
