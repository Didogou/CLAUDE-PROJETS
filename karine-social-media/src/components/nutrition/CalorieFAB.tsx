'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Flame } from 'lucide-react';
import { CalorieCounterSheetV2 } from './CalorieCounterSheetV2';
import { RingProgress } from './RingProgress';

/**
 * Bouton flottant compteur calories (bas-droite).
 *
 * Visible uniquement pour les abonnées (le serveur monte ce
 * composant seulement dans ce cas — cf. SubscriberFloatingTools).
 *
 * Masqué sur les pages admin. Au clic, ouvre la sheet V2 (layout
 * Apple Forme drill-down).
 */
export function CalorieFAB() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
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

  const percent =
    targetKcal > 0 && todayKcal !== null
      ? Math.min(100, Math.round((todayKcal / targetKcal) * 100))
      : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
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

      {open && (
        <CalorieCounterSheetV2
          onClose={() => setOpen(false)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
