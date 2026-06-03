'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Flame } from 'lucide-react';
import { CalorieCounterSheet } from './CalorieCounterSheet';

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

  const percent = targetKcal > 0 && todayKcal !== null
    ? Math.min(100, Math.round((todayKcal / targetKcal) * 100))
    : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Compteur de calories"
        className="fixed bottom-20 right-4 z-30 flex h-14 w-14 flex-col items-center justify-center rounded-full bg-coral text-white shadow-lg ring-2 ring-white transition-transform hover:scale-105 active:scale-95 print:hidden"
        style={{ fontSize: '0.625rem' }}
      >
        <Flame className="size-5" />
        {todayKcal !== null && (
          <span className="mt-0.5 font-bold leading-none">
            {todayKcal}
          </span>
        )}
        {/* Anneau de progression : rendu via box-shadow inset coloré
            sur le bord intérieur. Pour rester en rem partout, on
            utilise une simple barre absolue. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-full"
        >
          <span
            className="block h-full bg-white/70 transition-all"
            style={{ width: `${percent}%` }}
          />
        </span>
      </button>

      {open && (
        <CalorieCounterSheet
          onClose={() => setOpen(false)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
