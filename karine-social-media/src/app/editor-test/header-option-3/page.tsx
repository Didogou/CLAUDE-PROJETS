'use client';

import { useEffect, useState } from 'react';
import {
  Leaf,
  Menu,
  Heart,
  Lightbulb,
} from 'lucide-react';
import {
  MockHomeContent,
  MockBottomNav,
  MockFloralBackground,
} from '@/components/editor-test/MockHomeContent';

/**
 * POC Option 3 — RADICALE.
 *
 * Modifications par rapport à la home actuelle :
 *  - PAS de header chrome au repos. Burger flottant en overlay
 *    minimal en haut à gauche (ronde sur fond blush).
 *  - Le logo devient PARTIE INTÉGRANTE du WelcomeBlock comme H1
 *    éditorial (titre de magazine). "Karine 🌿 Diététique" intégré
 *    au-dessus du slogan "Prenons soin de vous ♥".
 *  - Flame (suivi calorique) MIGRE en badge sur l'onglet Accueil de
 *    la BottomNav (visible en permanence).
 *  - Bell DEVIENT un onglet dédié "Alertes" dans la BottomNav
 *    (remplace Favoris, qui passe en sous-menu Recettes — non POC).
 *  - User accessible uniquement via burger (perd 1 clic).
 *  - "Une idée ?" devient un FAB flottant discret en bas-droite.
 *
 * Précédent : Apple Fitness (pas de top bar, BottomNav porte tout).
 *
 * Objectif : maximaliser la zone éditoriale (contenu = roi).
 * Inconvénient : refonte BottomNav nécessaire en industrialisation.
 */
export default function HeaderOption3POC() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col">
      <MockFloralBackground />

      {/* Header sticky qui n'apparait QUE quand on scroll. Au repos
          (top de page), invisible. Au scroll : version mini-compacte
          avec juste burger + nom compact + actions essentielles. */}
      <header
        className={`sticky top-0 z-40 flex items-center justify-between bg-blush/85 px-5 py-2 backdrop-blur-xl backdrop-saturate-150 transition-all duration-300 ${
          scrolled
            ? 'translate-y-0 opacity-100 shadow-sm'
            : 'pointer-events-none -translate-y-full opacity-0'
        }`}
      >
        <button
          type="button"
          aria-label="Menu"
          className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-ink-soft"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="flex items-baseline gap-x-1">
          <span className="font-script text-xl font-bold text-coral-dark">
            Karine
          </span>
          <Leaf
            className="-translate-y-0.5 -rotate-12 self-center text-sage"
            strokeWidth={2.5}
            height={14}
            width={14}
          />
        </div>
        <div className="w-9" aria-hidden />
      </header>

      {/* Burger flottant overlay au repos — vis. uniquement quand le
          header sticky n'est pas affiché (top de page). */}
      {!scrolled && (
        <button
          type="button"
          aria-label="Menu"
          className="fixed left-4 top-4 z-30 grid h-10 w-10 place-items-center rounded-full bg-white/80 text-ink-soft shadow-md backdrop-blur transition hover:bg-white"
          style={{ marginTop: 'env(safe-area-inset-top)' }}
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* WelcomeBlock éditorial type magazine : Karine 🌿 Diététique
          intégré au-dessus du slogan, comme une couverture. */}
      <section className="px-5 pb-8 pt-16 text-center">
        <div className="mb-4 flex items-baseline justify-center gap-x-1.5">
          <span className="font-script text-4xl font-bold text-coral-dark sm:text-5xl">
            Karine
          </span>
          <Leaf
            className="-translate-y-0.5 -rotate-12 self-center text-sage"
            strokeWidth={2.5}
            height={24}
            width={24}
          />
          <span className="text-xs font-bold uppercase tracking-[0.3em] text-ink-soft sm:text-sm">
            Diététique
          </span>
        </div>
        <h2 className="font-script text-coral">
          <span style={{ fontSize: 'clamp(1.8rem, 9vw, 4rem)' }}>
            Prenons soin de vous
          </span>
          <Heart className="ml-2 inline-block h-6 w-6 fill-coral text-coral" />
        </h2>
      </section>

      <MockHomeContent />

      {/* FAB "Une idée ?" flottant en bas-droite, au-dessus de la
          BottomNav. Discret mais toujours accessible. */}
      <button
        type="button"
        aria-label="Une idée pour Karine"
        className="fixed bottom-20 right-4 z-30 grid h-12 w-12 place-items-center rounded-full bg-white text-amber-400 shadow-lg ring-2 ring-coral-soft transition hover:scale-110 active:scale-95"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Lightbulb className="h-5 w-5 fill-amber-400" />
      </button>

      <MockBottomNav withFlameBadge withBellTab />
    </div>
  );
}
