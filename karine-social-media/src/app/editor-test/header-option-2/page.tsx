'use client';

import { useEffect, useState } from 'react';
import { Leaf, Menu, Bell, User, Flame, Lightbulb, Heart } from 'lucide-react';
import {
  MockHomeContent,
  MockBottomNav,
  MockFloralBackground,
} from '@/components/editor-test/MockHomeContent';

/**
 * POC Option 2 — MÉDIANE (recommandée par le designer).
 *
 * Modifications par rapport à la home actuelle :
 *  - Header sur UNE SEULE LIGNE compacte permanente (text-2xl logo,
 *    pas de mode "grand puis collapse" — toujours compact)
 *  - "Une idée ?" descend dans le WelcomeBlock comme CTA secondaire,
 *    rattaché au slogan ("Prenons soin de vous ♥ — Une idée ?")
 *  - Slogan reste l'unique héros typographique de la home
 *
 * Précédent : Notion mobile (top bar mono-ligne minimaliste).
 *
 * Objectif : tester si la fusion "voix de marque + canal feedback"
 * dans le WelcomeBlock crée un bloc cohérent et libère le header.
 */
export default function HeaderOption2POC() {
  return (
    <div className="relative flex min-h-screen flex-col">
      <MockFloralBackground />

      {/* Header MONO-LIGNE compact permanent — pas de mode grand/petit.
          La marque vit dans le WelcomeBlock juste en-dessous. Le header
          devient un chrome iOS-style discret. */}
      <header className="sticky top-0 z-40 flex items-center justify-between bg-blush/85 px-5 py-2.5 backdrop-blur-xl backdrop-saturate-150">
        <button
          type="button"
          aria-label="Menu"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink-soft transition hover:bg-white"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-baseline gap-x-1">
          <span className="font-script text-2xl font-bold text-coral-dark">
            Karine
          </span>
          <Leaf
            className="-translate-y-0.5 -rotate-12 self-center text-sage"
            strokeWidth={2.5}
            height={16}
            width={16}
          />
          <span className="text-[0.55rem] font-bold uppercase tracking-[0.2em] text-ink-soft">
            Diététique
          </span>
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
      </header>

      {/* WelcomeBlock enrichi : slogan-héros + CTA "Une idée ?"
          rattaché en dessous. La marque parle d'une seule voix. */}
      <section className="px-5 py-8 text-center">
        <h2 className="font-script text-coral">
          <span style={{ fontSize: 'clamp(1.8rem, 9vw, 4rem)' }}>
            Prenons soin de vous
          </span>
          <Heart className="ml-2 inline-block h-6 w-6 fill-coral text-coral" />
        </h2>
        <button
          type="button"
          className="mx-auto mt-3 flex items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-4 shadow-sm ring-2 ring-coral-soft/60 transition hover:scale-105 active:scale-95"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-amber-400 ring-1 ring-coral-soft/40">
            <Lightbulb className="h-3.5 w-3.5 fill-amber-400" />
          </span>
          <span className="font-script text-base text-coral-dark">
            Une idée pour Karine&nbsp;?
          </span>
        </button>
      </section>

      <MockHomeContent />
      <MockBottomNav />
    </div>
  );
}
