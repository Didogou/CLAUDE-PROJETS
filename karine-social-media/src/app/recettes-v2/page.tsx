import type { Metadata } from 'next';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { RecettesOngletsView } from '@/components/recettes/RecettesOngletsView';
import { getPublishedRecipes } from '@/lib/recipes';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Recettes (v2) · Karine Diététique',
};

/**
 * POC route /recettes-v2 — refonte navigation recettes en ONGLETS
 * (Entrées / Plats / Desserts / Spécial) au lieu de piles par catégorie.
 *
 * Objectif : tester l'UX onglets avec Karine avant de remplacer la page
 * /recettes existante. Itérations attendues : mapping des catégories
 * Ciqual-style → 4 onglets, ordre des tuiles, intégration favoris,
 * recherche dans l'onglet courant.
 *
 * À supprimer dès qu'on bascule en prod (ou renommer en /recettes).
 */
export default async function RecettesV2Page() {
  const [recipes, user] = await Promise.all([
    getPublishedRecipes(),
    getCurrentUser(),
  ]);
  const userHasPlan =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Fond dégradé rose Karine (Fond_recette.png converti en WebP).
          Variant 'recettes' déclaré dans data/background-images.ts —
          Karine peut le surcharger depuis /admin/parametres/fonds. */}
      <FloralBackground variant="recettes" />

      {/* Petite fée en overlay haut-gauche. Position figée après
          itération visuelle via FeeEditor (POC 2026-06-07).
          Mobile (< 1024px) : left:10.9vw  top:64px  width:31.3vw
          PC     (≥ 1024px) : left:35.2vw  top:95px  width:12.0vw
          pointer-events-none : laisse passer le clic vers le burger
          menu derrière. eslint-disable-next-line @next/next/no-img-element */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/recettes/fee.webp"
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-[10.9vw] top-[64px] z-[1] w-[31.3vw] lg:left-[35.2vw] lg:top-[95px] lg:w-[12vw]"
      />

      <AppHeader withSlogan />
      <main className="mx-auto w-full max-w-md flex-1 px-3 pb-8 sm:max-w-2xl sm:px-4 lg:max-w-5xl lg:px-8">
        <RecettesOngletsView recipes={recipes} userHasPlan={userHasPlan} />
      </main>
      <BottomNav />
    </div>
  );
}
