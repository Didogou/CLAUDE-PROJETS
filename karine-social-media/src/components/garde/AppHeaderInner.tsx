'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Bell, LogIn, User } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { MainDrawer } from './MainDrawer';
import { IdeasFloatingButton } from '@/components/ideas/IdeasFloatingButton';
import { TrackingPill } from '@/components/nutrition/TrackingPill';
import { WaterPill } from '@/components/nutrition/WaterPill';

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
  pageTitle,
  backHref,
  avatarUrl,
  homeExtraTop = false,
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
  /** Titre de la page courante. Quand fourni, Logo passe en
   *  forceCompact et le titre s'affiche à la place du slogan. */
  pageTitle?: string;
  /** Si fourni, REMPLACE le burger menu par une flèche retour. */
  backHref?: string;
  /** Photo de profil de l'utilisatrice. Si fournie, affichée dans
   *  le badge profil à la place de l'icône Lucide générique. */
  avatarUrl?: string | null;
  /** Padding-top supplémentaire — uniquement utilisé sur la page
   *  d'accueil pour décaler le wordmark vers le bas (UX 2026-06-12). */
  homeExtraTop?: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);
  // Si l'admin a clique "Voir le site abonne" depuis /admin, il
  // navigue avec ?as=visitor sur la home. Le flag est stocke en
  // sessionStorage des qu'on l'a vu une fois, puis AppHeader sur
  // toutes les pages internes peut le re-lire (le query param
  // disparait dès qu'on navigue vers /recettes, /courses, etc.).
  // On evite useSearchParams() qui nécessite un Suspense boundary
  // (Next.js 16) et casse le build des pages statiques. On lit
  // window.location.search dans useEffect, re-evalue a chaque
  // changement de pathname.
  const pathname = usePathname();
  const [asVisitorSticky, setAsVisitorSticky] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('as') === 'visitor';
    if (fromUrl) {
      sessionStorage.setItem('karine_as_visitor', '1');
      setAsVisitorSticky(true);
      return;
    }
    if (sessionStorage.getItem('karine_as_visitor') === '1') {
      setAsVisitorSticky(true);
    }
  }, [pathname]);

  const effectiveBackHref =
    backHref && asVisitorSticky && !backHref.includes('as=visitor')
      ? `${backHref}${backHref.includes('?') ? '&' : '?'}as=visitor`
      : backHref;

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
      className={`sticky top-0 z-40 flex flex-col px-5 transition-[padding,box-shadow,background-color,backdrop-filter] duration-500 ease-in-out ${
        scrolled
          ? 'bg-blush/85 py-1.5 shadow-sm backdrop-blur-xl backdrop-saturate-150 lg:py-2'
          : homeExtraTop
            ? 'bg-transparent pb-3 pt-6 lg:pb-5 lg:pt-9'
            : 'bg-transparent py-3 lg:py-5'
      }`}
    >
      <div className="flex items-center justify-between">
        {/* Si backHref fourni, on REMPLACE le burger par une flèche
            retour (Option B nav 2026-06-08). Choix volontaire vs
            l'ajout en plus : sur mobile, le slot gauche est restreint,
            et "sur cette sous-page, le geste principal à gauche c'est
            revenir, pas naviguer ailleurs". Le burger reste accessible
            via la page parente. */}
        {effectiveBackHref ? (
          <Link
            href={effectiveBackHref}
            aria-label="Retour"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-coral-dark ring-1 ring-coral-soft/40 backdrop-blur transition hover:bg-white"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.4} />
          </Link>
        ) : (
          <MainDrawer isAdmin={isAdmin} isAuthenticated={isAuthenticated} />
        )}

        {/* Logo : sur les pages avec pageTitle, forceCompact=true
            → wordmark mini en permanence, le titre prend la place
            visuelle du slogan. */}
        <div className="flex flex-col items-center leading-none">
          <Logo
            slogan={withSlogan}
            compact={scrolled}
            forceCompact={Boolean(pageTitle)}
          />
          {/* Titre de page (Option C). Même style script-coral que le
              slogan pour préserver l'identité, mais légèrement plus
              petit pour ne pas dominer le wordmark. Collapse au scroll
              comme le faisait le slogan. */}
          {pageTitle && (
            <span
              // Adaptation automatique de la taille selon la longueur :
              //  - court (< 12 char) : énorme (text-5xl/6xl)
              //  - moyen (12-20)     : grand (text-4xl/5xl)
              //  - long  (> 20)      : modéré (text-3xl/4xl)
              // text-balance pour break naturel + line-clamp anti
              // chevauchement des icônes back/account aux extrémités.
              // max-w-[14rem] sm:max-w-[20rem] pour cap la largeur.
              className={`mx-auto block max-w-[14rem] overflow-hidden pb-2 text-center font-script leading-snug text-coral-dark transition-all duration-500 ease-in-out sm:max-w-[20rem] ${
                scrolled
                  ? 'mt-0 max-h-8 truncate whitespace-nowrap text-xl opacity-100'
                  : `mt-4 line-clamp-2 text-balance opacity-100 sm:mt-5 ${
                      pageTitle.length > 20
                        ? 'text-3xl sm:text-4xl'
                        : pageTitle.length > 12
                          ? 'text-4xl sm:text-5xl'
                          : 'text-5xl sm:text-6xl'
                    }`
              }`}
              style={{
                textShadow: '0 1px 2px rgba(255,255,255,0.6)',
              }}
            >
              {pageTitle}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Verre d'eau à GAUCHE de la flamme calorie. Affiché si la
              feature water tracking est activée globalement (feature flag
              parallèle à trackingBehavior). Au clic : ouvre la sheet
              slide-up (même design que l'ancien Mes calories). */}
          {trackingBehavior && (
            <WaterPill isAuthenticated={isAuthenticated} />
          )}

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
            <ProfileMenu unreadCount={unreadCount} avatarUrl={avatarUrl} />
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
function ProfileMenu({
  unreadCount,
  avatarUrl,
}: {
  unreadCount: number;
  avatarUrl?: string | null;
}) {
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
        className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-white/50 text-ink ring-2 ring-coral-soft backdrop-blur transition hover:bg-white/80"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
          />
        ) : (
          <User className="h-4 w-4" strokeWidth={2} />
        )}
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
