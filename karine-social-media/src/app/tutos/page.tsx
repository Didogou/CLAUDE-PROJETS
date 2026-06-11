import type { Metadata } from 'next';
import { PlayCircle } from 'lucide-react';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';

export const metadata: Metadata = {
  title: 'Tutos de Karine · Karine Diététique',
};

/**
 * Page Tutos de Karine — placeholder V1.
 *
 * Sera enrichie ultérieurement avec une liste de vidéos courtes
 * (recettes, gestes, méthodes). Pour l'instant, écran d'attente.
 */
export default function TutosPage() {
  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader pageTitle="Tutos de Karine" backHref="/" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 pb-12 text-center sm:max-w-2xl">
        <div className="rounded-3xl bg-white/85 p-8 shadow-sm">
          <PlayCircle
            className="mx-auto h-14 w-14 text-coral"
            strokeWidth={1.8}
          />
          <h2 className="mt-3 font-script text-2xl text-coral-dark">
            Bientôt en ligne ♡
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Karine prépare une collection de petits tutos vidéo pour
            t'accompagner au quotidien. Reviens vite !
          </p>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
