import Link from 'next/link';
import { ArrowLeft, Heart } from 'lucide-react';
import { Logo } from './Logo';

/**
 * Header de marque pour les pages d'authentification (/login,
 * /signup, /mot-de-passe-oublie, /nouveau-mot-de-passe).
 *
 * - Flèche "retour à l'accueil" en haut à gauche (pattern identique
 *   aux autres pages de l'app : MenuDayHeader, /recettes/[slug], etc.)
 * - Logo Karine centré
 * - Slogan court optionnel
 *
 * Remplace l'ancien BrandHeader (logo centré sans flèche retour) :
 * la flèche en haut donne une porte de sortie immédiatement visible,
 * cohérente avec le reste de l'app.
 */
export function AuthHeader({ slogan }: { slogan?: string }) {
  return (
    <div className="relative px-3 pt-4 sm:px-6 sm:pt-6">
      {/* Flèche retour : top-left, cohérent avec MenuDayHeader. */}
      <Link
        href="/"
        aria-label="Retour à l'accueil"
        className="absolute left-3 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink shadow-sm transition hover:bg-white sm:left-6 sm:top-6"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>

      {/* Logo + slogan centrés. */}
      <div className="flex flex-col items-center text-center">
        <Link
          href="/"
          aria-label="Karine Diététique — Accueil"
          className="transition hover:opacity-80"
        >
          <Logo />
        </Link>
        {slogan !== '' && (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-coral sm:text-sm">
            <Heart className="h-3.5 w-3.5 fill-coral-soft text-coral" />
            {slogan ?? 'Bien manger, se sentir bien'}
            <Heart className="h-3.5 w-3.5 fill-coral-soft text-coral" />
          </p>
        )}
      </div>
    </div>
  );
}
