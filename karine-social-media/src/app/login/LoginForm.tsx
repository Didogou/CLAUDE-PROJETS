'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HeartHandshake, KeyRound, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Mode = 'password' | 'magic' | 'patient';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect =
    searchParams.get('next') ?? searchParams.get('redirect') ?? '/';
  const reason = searchParams.get('reason');

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [patientMessage, setPatientMessage] = useState('');
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

  /**
   * Patiente : signup (ou login si compte existe) + création de la demande
   * d'accès patient avec le message. Karine valide ensuite dans /admin.
   */
  async function handlePatientSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      // 1. Tentative de signup (sera no-op si l'email existe déjà → on essaie login)
      let signedIn = false;
      const { error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });

      if (signUpErr && /already|registered/i.test(signUpErr.message)) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr) throw new Error(signInErr.message);
        signedIn = true;
      } else if (signUpErr) {
        throw new Error(signUpErr.message);
      } else {
        signedIn = true;
      }

      if (!signedIn) {
        setMessage(
          'Compte créé. Vérifie ton email pour confirmer, puis reviens envoyer la demande.',
        );
        setLoading(false);
        return;
      }

      // 2. Créer la demande d'accès patient
      const res = await fetch('/api/patient-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: patientMessage }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Échec création de la demande');
      }

      setMessage(
        'Demande envoyée à Karine ! Tu recevras un accès dès qu\'elle l\'aura validée.',
      );
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-center font-script text-5xl text-coral-dark">Connexion</h1>

        {reason === 'forbidden' && (
          <div className="rounded-xl border border-coral-soft bg-white/80 p-3 text-center text-sm text-coral-dark shadow-sm">
            Connecte-toi pour accéder à cette page.
          </div>
        )}

        {/* Onglets — 3 modes : connexion, magic link, patiente */}
        <div className="flex flex-col gap-1 rounded-2xl bg-white/70 p-1 shadow-sm sm:flex-row">
          <TabButton active={mode === 'password'} onClick={() => setMode('password')} icon={KeyRound}>
            Mot de passe
          </TabButton>
          <TabButton active={mode === 'magic'} onClick={() => setMode('magic')} icon={Sparkles}>
            Lien magique
          </TabButton>
          <TabButton active={mode === 'patient'} onClick={() => setMode('patient')} icon={HeartHandshake}>
            Je suis patiente
          </TabButton>
        </div>

        {mode === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Mot de passe">
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />
            </Field>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-coral py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
            >
              {loading ? '...' : isSignUp ? 'Créer un compte' : 'Se connecter'}
            </button>
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="w-full text-sm text-coral hover:underline"
            >
              {isSignUp ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? Créer un compte'}
            </button>
          </form>
        )}

        {mode === 'magic' && (
          <form onSubmit={handleMagicLinkSubmit} className="space-y-4">
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </Field>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-coral py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
            >
              {loading ? '...' : 'Recevoir le lien'}
            </button>
            <p className="text-center text-xs text-ink-soft">
              Tu recevras un email avec un lien pour te connecter sans mot de passe.
            </p>
          </form>
        )}

        {mode === 'patient' && (
          <form onSubmit={handlePatientSubmit} className="space-y-4">
            <div className="rounded-xl border border-coral-soft bg-coral-soft/30 p-3 text-xs text-coral-dark">
              Tu es patiente de Karine ? Crée ton compte ici et envoie ta demande
              d&apos;accès. Karine vérifiera dans son admin et tu auras un accès
              gratuit de 6 semaines.
            </div>
            <Field label="Nom complet">
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="ex. Marie Dupont"
                className="input"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Mot de passe">
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Message pour Karine">
              <textarea
                value={patientMessage}
                onChange={(e) => setPatientMessage(e.target.value)}
                rows={3}
                placeholder="ex. RDV du 12 mai à 14h, suivi nutrition"
                className="input"
              />
            </Field>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-coral py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
            >
              {loading ? '...' : 'Envoyer ma demande'}
            </button>
          </form>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-xl border border-sage/40 bg-sage/10 p-3 text-sm text-ink">
            {message}
          </div>
        )}

        <style>{`
          .input { width: 100%; border-radius: 9999px; border: 1px solid rgba(226,120,141,0.4); background: #fff; padding: 0.5rem 0.875rem; font-size: 0.875rem; color: #4b4248; outline: none; }
          .input:focus { border-color: #e2788d; }
          textarea.input { border-radius: 1rem; resize: vertical; min-height: 4rem; }
        `}</style>
      </div>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof HeartHandshake;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition sm:text-sm ${
        active
          ? 'bg-coral text-white shadow'
          : 'bg-white text-ink-soft hover:bg-coral-soft/30'
      }`}
    >
      <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      {children}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
    </label>
  );
}
