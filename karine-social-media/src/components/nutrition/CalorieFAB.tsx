'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Flame, Sparkles } from 'lucide-react';
import { CalorieCounterSheet } from './CalorieCounterSheet';
import { CalorieCounterSheetV2 } from './CalorieCounterSheetV2';
import { RingProgress } from './RingProgress';

/**
 * Bouton flottant compteur calories (bas-droite).
 *
 * Visible uniquement pour les abonnées (le serveur monte ce
 * composant seulement dans ce cas — cf. SubscriberFloatingTools).
 *
 * Masqué sur les pages admin et sur la page de lecture jour menus
 * où l'utilisatrice a déjà les CTA Mes courses (évite de gêner).
 * Au clic, ouvre la sheet plein écran (mobile-first).
 */
export function CalorieFAB() {
  const pathname = usePathname();
  // 2 FAB cote a cote pour comparer V1 et V2 (decision Karine
  // 2026-06-05). Quand V2 sera valide, on retirera ce bouton et on
  // supprimera le fichier CalorieCounterSheet.tsx.
  const [open, setOpen] = useState<false | 'v1' | 'v2'>(false);
  const [todayKcal, setTodayKcal] = useState<number | null>(null);
  const [targetKcal, setTargetKcal] = useState<number>(2000);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/nutrition/today', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setTodayKcal(Math.round(data.totals?.kcal ?? 0));
      setTargetKcal(data.target?.dailyKcal ?? 2000);
    } catch {
      // silencieux, le FAB reste fonctionnel sans badge
    }
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('nutrition-log-updated', onChange);
    return () => window.removeEventListener('nutrition-log-updated', onChange);
  }, [refresh]);

  // Masque sur l'admin (au cas où une admin est aussi abonnée).
  if (pathname?.startsWith('/admin')) return null;

  const percent = targetKcal > 0 && todayKcal !== null
    ? Math.min(100, Math.round((todayKcal / targetKcal) * 100))
    : 0;

  return (
    <>
      {/* FAB principal — sheet V1 actuelle. */}
      <button
        type="button"
        onClick={() => setOpen('v1')}
        aria-label="Compteur de calories"
        className="fixed bottom-20 right-2 z-30 flex h-14 w-14 flex-col items-center justify-center rounded-full bg-coral text-white shadow-lg ring-2 ring-white transition-transform hover:scale-105 active:scale-95 print:hidden"
      >
        <RingProgress percent={percent} color="white" strokeWidth={6} />
        <Flame className="relative size-4" />
        {todayKcal !== null ? (
          <span
            className="relative font-bold leading-none"
            style={{ fontSize: '0.75rem' }}
          >
            {todayKcal}
          </span>
        ) : (
          <span
            className="relative font-bold leading-none"
            style={{ fontSize: '0.625rem' }}
          >
            kcal
          </span>
        )}
      </button>

      {/* FAB secondaire — sheet V2 (layout Apple Forme). Temporaire
          pour permettre la comparaison. Positionné suffisamment au-
          dessus du FAB calorie pour ne pas se chevaucher avec lui ni
          avec le FAB eau qui est juste à côté. */}
      <button
        type="button"
        onClick={() => setOpen('v2')}
        aria-label="Compteur de calories — V2 (test layout)"
        title="Tester le nouveau layout (V2)"
        className="fixed bottom-[10.5rem] right-2 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-violet-500 text-white shadow-lg ring-2 ring-white transition-transform hover:scale-105 active:scale-95 print:hidden"
      >
        <Sparkles className="size-5" />
        <span
          className="absolute -bottom-1 -right-1 rounded-full bg-white px-1 text-[0.55rem] font-bold leading-tight text-violet-600 ring-1 ring-violet-500"
        >
          V2
        </span>
      </button>

      {open === 'v1' && (
        <CalorieCounterSheet
          onClose={() => setOpen(false)}
          onChanged={refresh}
        />
      )}
      {open === 'v2' && (
        <CalorieCounterSheetV2
          onClose={() => setOpen(false)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
