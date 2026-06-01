import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * Footer minimal pour les pages d'authentification (/login, /signup,
 * /mot-de-passe-oublie, /nouveau-mot-de-passe). Donne un retour explicite
 * vers la home pour les utilisatrices qui ne veulent pas se connecter
 * (elles peuvent toujours parcourir le contenu visiteur).
 */
export function AuthFooter() {
  return (
    <footer className="px-3 pb-6 pt-2 text-center sm:px-6 sm:pb-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-ink-soft transition hover:bg-white/60 hover:text-coral-dark sm:text-sm"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Retour à l&apos;accueil
      </Link>
    </footer>
  );
}
