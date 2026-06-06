'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, LogIn, User } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { MainDrawer } from './MainDrawer';
import { IdeasFloatingButton } from '@/components/ideas/IdeasFloatingButton';
import { TrackingPill } from '@/components/nutrition/TrackingPill';

/**
 * Partie client de l'AppHeader.
 *
 * Reçoit les données utilisateur déjà fetchées par le composant
 * server-side parent, ajoute la détection scroll + le collapse du
 * titre (pattern iOS Large Title).
 *
 * - Au repos : logo grand (text-5xl) + slogan optionnel
 * - Scrolled > 24px : logo compact sur une ligne (text-2xl), pas de
 *   slogan, padding vertical réduit, ombre douce pour démarquer du
 *   contenu derrière. Transition CSS smooth 250ms.
 */
export function AppHeaderInner({
  isAuthenticated,
  isAdmin,
  unreadCount,
  trackingBehavior,
  canEditTracking,
  withSlogan,
  withIdeas,
}: {
  isAuthenticated: boolean;
  isAdmin: boolean;
  unreadCount: number;
  /** Comportement de la TrackingPill (null = icône cachée). */
  trackingBehavior: 'sheet' | 'plan' | 'login' | null;
  /** true si l'utilisatrice peut éditer son tracking (ajouter repas /
   *  eau). False pour les connectées sans abonnement → sheet en
   *  lecture seule. */
  canEditTracking: boolean;
  withSlogan: boolean;
  /** Affiche le bouton "Une idée ?" sur la deuxième ligne. Réservé
   *  à la page d'accueil. */
  withIdeas: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // Hystérésis pour éviter le clignotement : quand le header passe
    // en compact, sa hauteur diminue → le contenu remonte → scrollY
    // diminue → repasse sous le seuil → boucle infinie. On utilise
    // donc 2 seuils différents :
    //  - non-compact → compact si scrollY > 48
    //  - compact → non-compact si scrollY < 8
    // L'écart 8-48 forme un buffer où l'état reste stable.
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled((prev) => (prev ? y > 8 : y > 48));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      // Option B (translucent au scroll seulement) :
      //  - Au repos en haut : fond transparent → le FloralBackground
      //    apparait pleinement derrière "Karine Diététique".
      //  - Au scroll : fond blush translucide + blur pour rester
      //    lisible par-dessus le contenu défilant.
      // Le bg-blush/85 + backdrop-blur ne s'active que via le toggle
      // `scrolled`. Transition `bg-*` smooth pour fade-in du fond.
      className={`sticky top-0 z-40 flex flex-col px-5 transition-[padding,box-shadow,background-color,backdrop-filter] duration-300 ${
        scrolled
          ? 'bg-blush/85 py-1.5 shadow-sm backdrop-blur-xl backdrop-saturate-150 lg:py-2'
          : 'bg-transparent py-3 lg:py-5'
      }`}
    >
      <div className="flex items-center justify-between">
        <MainDrawer isAdmin={isAdmin} isAuthenticated={isAuthenticated} />

        <Logo slogan={withSlogan} compact={scrolled} />

        <div className="flex items-center gap-2">
          {/* Flame de suivi calorique : toujours visible si la feature
              est activée globalement. Le clic est routé selon le statut
              (sheet/plan/login). Voir TrackingPill. */}
          {trackingBehavior && (
            <TrackingPill
              behavior={trackingBehavior}
              canEdit={canEditTracking}
            />
          )}

          {isAuthenticated ? (
            <ProfileMenu unreadCount={unreadCount} />
          ) : (
            /* Visiteuse non connectée : icône LogIn en cercle compact
               (h-8), même format visuel que Flame et le bouton Profil.
               L'icône Lucide "LogIn" = flèche entrant dans une boîte,
               standard universel pour "se connecter". */
            <Link
              href="/login"
              aria-label="Se connecter"
              className="grid h-8 w-8 place-items-center rounded-full bg-white/50 text-ink ring-2 ring-coral-soft backdrop-blur transition hover:bg-white/80"
            >
              <LogIn className="h-4 w-4" strokeWidth={2} />
            </Link>
          )}
        </div>
      </div>

      {/* Bouton "Une idée ?" — RÉSERVÉ à la page d'accueil (withIdeas).
          Disparait en mode scrolled pour que le header soit plus compact. */}
      {withIdeas && isAuthenticated && !scrolled && (
        <div className="mt-2 flex justify-start">
          <IdeasFloatingButton />
        </div>
      )}
    </header>
  );
}

/**
 * Hub personnel : bouton User unique qui ouvre un popover avec
 * 2 entrées (Profil + Notifications). Le badge unreadCount migre
 * sur l'avatar — l'utilisatrice voit qu'elle a du courrier sans
 * avoir 2 icones séparées.
 *
 * Pattern : Material Account Menu / iOS Profile Sheet.
 *
 * - Tap sur User → ouvre le popover ancré sous l'avatar (anim slide-down)
 * - Tap outside / Escape → ferme
 * - Tap sur Profil ou Notifications → navigue (Link Next.js)
 */
function ProfileMenu({ unreadCount }: { unreadCount: number }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0
            ? `Mon profil (${unreadCount} notifications non lues)`
            : 'Mon profil'
        }
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative grid h-8 w-8 place-items-center rounded-full bg-white/50 text-ink ring-2 ring-coral-soft backdrop-blur transition hover:bg-white/80"
      >
        <User className="h-4 w-4" strokeWidth={2} />
        {/* Badge unreadCount sur l'avatar — l'utilisatrice voit
            qu'elle a des notifications sans avoir 2 icones. */}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[0.6rem] font-bold text-white ring-2 ring-white/80">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="anim-fade-in absolute right-0 top-10 z-50 min-w-[12rem] overflow-hidden rounded-2xl border border-coral-soft/40 bg-white shadow-xl"
        >
          <Link
            href="/profil"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-sm font-semibold text-ink transition hover:bg-coral-soft/30"
          >
            <User className="h-4 w-4 text-coral" />
            Profil
          </Link>
          <div className="h-px bg-coral-soft/30" />
          <Link
            href="/notifications"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink transition hover:bg-coral-soft/30"
          >
            <span className="flex items-center gap-3">
              <Bell className="h-4 w-4 text-coral" />
              Notifications
            </span>
            {unreadCount > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1.5 text-[0.65rem] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
        </div>
      )}
    </div>
  );
}
