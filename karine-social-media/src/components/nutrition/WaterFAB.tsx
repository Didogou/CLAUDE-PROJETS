'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { GlassWater } from 'lucide-react';
import { WaterCounterSheet } from './WaterCounterSheet';
import { RingProgress } from './RingProgress';

/**
 * Bouton flottant verre d'eau (au-dessus du CalorieFAB).
 *
 * Click = ouvre la WaterCounterSheet dédiée (+1 / -1 / réglages /
 * historique). Affiche un anneau de progression circulaire + le
 * compteur verres au centre.
 *
 * Sync avec la sheet via event 'water-log-updated'.
 */
export function WaterFAB() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [glasses, setGlasses] = useState<number | null>(null);
  const [target, setTarget] = useState<number>(6);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/water/today', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setGlasses(Number(data.glassesCount) || 0);
      const targetGlasses = Math.max(
        1,
        Math.round((data.targetMl ?? 1500) / (data.glassSizeMl ?? 250)),
      );
      setTarget(targetGlasses);
    } catch {
      // silencieux
    }
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('water-log-updated', onChange);
    return () => window.removeEventListener('water-log-updated', onChange);
  }, [refresh]);

  if (pathname?.startsWith('/admin')) return null;

  const percent =
    target > 0 && glasses !== null
      ? Math.min(100, Math.round((glasses / target) * 100))
      : 0;
  const reached = glasses !== null && glasses >= target;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Compteur d'eau"
        title="Compteur d'eau"
        className={`fixed bottom-36 right-2 z-30 flex h-14 w-14 flex-col items-center justify-center rounded-full text-white shadow-lg ring-2 ring-white transition-transform hover:scale-105 active:scale-95 print:hidden ${
          reached ? 'bg-emerald-500' : 'bg-sky-400'
        }`}
      >
        <RingProgress percent={percent} color="white" strokeWidth={6} />
        <GlassWater className="relative size-4" />
        {glasses !== null ? (
          <span
            className="relative font-bold leading-none"
            style={{ fontSize: '0.75rem' }}
          >
            {glasses}/{target}
          </span>
        ) : (
          <span
            className="relative font-bold leading-none"
            style={{ fontSize: '0.625rem' }}
          >
            eau
          </span>
        )}
      </button>

      {open && (
        <WaterCounterSheet onClose={() => setOpen(false)} onChanged={refresh} />
      )}
    </>
  );
}
