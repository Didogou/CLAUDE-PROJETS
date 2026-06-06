'use client';

import { useEffect, useState } from 'react';
import { Leaf, Menu, Bell, User, Flame, Lightbulb, Heart } from 'lucide-react';
import {
  MockHomeContent,
  MockBottomNav,
  MockFloralBackground,
} from '@/components/editor-test/MockHomeContent';

/**
 * POC Option 1 — DOUCE.
 *
 * Modifications par rapport à la home actuelle :
 *  - Logo réduit : "Karine 🌿" seul (mot "Diététique" supprimé)
 *  - Taille mobile : text-3xl au lieu de text-3xl (déjà mobile, mais
 *    on compacte horizontalement en supprimant "Diététique")
 *  - Le reste (burger, 3 icones, "Une idée ?", slogan) inchangé
 *
 * Objectif : tester si supprimer juste le doublon typographique
 * "Karine Diététique" + "Karine prend soin de vous" suffit à
 * désaturer le header.
 */
export default function HeaderOption1POC() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col">
      <MockFloralBackground />

      <header
        className={`sticky top-0 z-40 flex flex-col bg-blush/85 px-5 backdrop-blur-xl backdrop-saturate-150 transition-[padding,box-shadow] duration-300 ${
          scrolled ? 'py-1.5 shadow-sm lg:py-2' : 'py-3 lg:py-5'
        }`}
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Menu"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink-soft transition hover:bg-white"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Logo épuré : "Karine 🌿" — pas de mot "Diététique".
              Mode compact au scroll. */}
          <div className="flex items-baseline gap-x-1 sm:gap-x-1.5">
            <span
              className={`font-script font-bold text-coral-dark transition-[font-size] duration-300 ease-out ${
                scrolled ? 'text-2xl' : 'text-3xl sm:text-5xl'
              }`}
            >
              Karine
            </span>
            <Leaf
              className={`-translate-y-0.5 -rotate-12 self-center text-sage transition-[width,height] duration-300 ease-out ${
                scrolled ? 'h-4 w-4' : 'h-5 w-5 sm:h-6 sm:w-6'
              }`}
              strokeWidth={2.5}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-full bg-white text-coral shadow-md ring-2 ring-coral"
            >
              <Flame className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/50 text-ink ring-2 ring-coral-soft"
            >
              <Bell className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/50 text-ink ring-2 ring-coral-soft"
            >
              <User className="h-5 w-5" />
            </button>
          </div>
        </div>

        {!scrolled && (
          <div className="mt-2 flex justify-start">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full bg-white py-1 pl-1 pr-3 shadow-md ring-2 ring-coral-soft/60"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-amber-400 ring-1 ring-coral-soft/40">
                <Lightbulb className="h-3.5 w-3.5 fill-amber-400" />
              </span>
              <span className="font-script text-base text-coral-dark">
                Une idée&nbsp;?
              </span>
            </button>
          </div>
        )}
      </header>

      {/* WelcomeBlock conservé tel quel. */}
      <section className="px-5 py-6 text-center">
        <h2 className="font-script text-coral">
          <span style={{ fontSize: 'clamp(1.8rem, 9vw, 4rem)' }}>
            Prenons soin de vous
          </span>
          <Heart className="ml-2 inline-block h-6 w-6 fill-coral text-coral" />
        </h2>
      </section>

      <MockHomeContent />
      <MockBottomNav />
    </div>
  );
}
