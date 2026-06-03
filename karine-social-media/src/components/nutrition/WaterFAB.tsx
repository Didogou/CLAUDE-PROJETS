'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { GlassWater } from 'lucide-react';

/**
 * Bouton flottant verre d'eau.
 *
 * Placé au-dessus du CalorieFAB (bottom-36). Click = +1 verre.
 * Anim eau (pulse + ring) au tap. Pour régler l'objectif ou la
 * taille du verre, l'utilisatrice passe par la CalorieCounterSheet
 * (section Eau) — on garde le FAB minimaliste.
 *
 * Sync avec la sheet calories via event 'water-log-updated'.
 */
export function WaterFAB() {
  const pathname = usePathname();
  const [glasses, setGlasses] = useState<number | null>(null);
  const [target, setTarget] = useState<number>(6);
  const [pulsing, setPulsing] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/water/today', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setGlasses(Number(data.glassesCount) || 0);
      // Objectif en verres = round(target_ml / glass_size_ml)
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

  async function handleAdd() {
    if (busy) return;
    setBusy(true);
    setPulsing(true);
    setTimeout(() => setPulsing(false), 600);
    try {
      const res = await fetch('/api/water/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await refresh();
        window.dispatchEvent(new CustomEvent('water-log-updated'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (pathname?.startsWith('/admin')) return null;

  const percent = target > 0 && glasses !== null
    ? Math.min(100, Math.round((glasses / target) * 100))
    : 0;
  const reached = glasses !== null && glasses >= target;

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={busy}
      aria-label="Boire un verre d'eau"
      title="Ajouter un verre d'eau"
      className={`fixed bottom-36 right-4 z-30 flex h-12 w-12 flex-col items-center justify-center rounded-full text-white shadow-lg ring-2 ring-white transition-transform active:scale-90 print:hidden ${
        pulsing ? 'animate-pulse' : ''
      } ${reached ? 'bg-emerald-500' : 'bg-sky-400'}`}
      style={{ fontSize: '0.6rem' }}
    >
      <GlassWater className="size-4" />
      {glasses !== null && (
        <span className="mt-0.5 font-bold leading-none">
          {glasses}/{target}
        </span>
      )}
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
  );
}
