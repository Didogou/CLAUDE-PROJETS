'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';

/**
 * Header de la page /menus/[id]/jour.
 *
 * Différent de AppHeader : pas de burger ni d'icones droite, juste
 * un bouton retour à gauche et le Logo centré. Mais doit respecter
 * la même règle de sticky + collapse au scroll que le reste de l'app
 * (sinon il sort de l'écran et l'utilisatrice perd la repère).
 *
 * Pattern iOS Large Title :
 *  - Au repos : Logo grand, padding généreux
 *  - Scrolled > 24px : Logo compact, padding réduit, ombre douce
 */
export function MenuDayHeader({ backHref = '/menus' }: { backHref?: string }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // Hystérésis pour éviter le clignotement au pivot du seuil :
    //  - non-compact → compact si scrollY > 48
    //  - compact → non-compact si scrollY < 8
    // Sans ce buffer, le changement de hauteur du header sticky en
    // mode compact ré-affecte scrollY → boucle de feedback.
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
      // Option B : transparent au repos, translucide au scroll.
      // Voir AppHeaderInner pour la justification du pattern.
      className={`sticky top-0 z-40 flex items-center px-5 transition-[padding,box-shadow,background-color,backdrop-filter] duration-300 print:hidden ${
        scrolled
          ? 'bg-blush/85 py-1.5 shadow-sm backdrop-blur-xl backdrop-saturate-150 lg:py-2'
          : 'bg-transparent py-6 lg:py-8'
      }`}
    >
      <Link
        href={backHref}
        aria-label="Retour aux menus"
        className="z-10 grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink transition hover:bg-white"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Logo compact={scrolled} />
      </div>
    </header>
  );
}
