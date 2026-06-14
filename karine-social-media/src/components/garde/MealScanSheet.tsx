'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ImageIcon, Check, Pencil, RotateCcw } from 'lucide-react';
import {
  MEAL_URL_SLUG,
  defaultMealForHour,
  type MealCategory,
} from '@/components/nutrition/CalorieCounterSheetV2';
import { MacroRing } from '@/components/nutrition/MacroRing';
import { compressImage } from '@/lib/compress-image';

/**
 * Phase 3 — Écran « scan repas » in-app (effet wouah, single-page).
 *
 * Layout scindé :
 *   • HAUT  = caméra LIVE / photo figée. Cadre blanc en cadrage, scan rose
 *     pendant l'analyse, puis total kcal qui DÉFILE + 3 anneaux P/L/G
 *     (projection du jour APRÈS ajout) incrustés en transparence sur la photo.
 *   • BAS   = vignettes des aliments détectés (avec kcal) + actions.
 *
 * Pipeline backend INCHANGÉ : compress → describe-meal (Vision) → parse
 * (Ciqual) → today (objectifs + totaux du jour). « Ajouter » logue direct
 * (kcal PAR PORTION, convention CalorieCounterSheetV2) sans changer de page ;
 * « Ajuster en détail » route vers la fiche riche /mes-calories/<slug>.
 *
 * Caméra validée Android+iOS (2026-06-14, nécessitait Permissions-Policy
 * camera=(self)). Wouah 100% CSS keyframes thémées, zéro dépendance ajoutée.
 */

type ScanItem = {
  label: string;
  portions: number;
  approxGrams: number;
  match: { alimCode: number } | null;
  kcalPerPortion: number | null;
  proteinsPerPortion: number | null;
  lipidsPerPortion: number | null;
  carbsPerPortion: number | null;
};

type DayState = {
  target: {
    dailyProteinsG: number | null;
    dailyLipidsG: number | null;
    dailyCarbsG: number | null;
  };
  totals: { proteinsG: number; lipidsG: number; carbsG: number };
};

const MEAL_LABEL: Record<MealCategory, string> = {
  breakfast: 'petit-déjeuner',
  lunch: 'déjeuner',
  snack: 'goûter',
  dinner: 'dîner',
};

/**
 * Compteur animé 0 → target (easeOutCubic) via requestAnimationFrame.
 * `run` déclenche l'animation. Respecte prefers-reduced-motion.
 */
function useCountUp(target: number, durationMs = 950, run = true): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || target <= 0) {
      const jump = requestAnimationFrame(() => setVal(target));
      return () => cancelAnimationFrame(jump);
    }
    let raf = 0;
    let start: number | null = null;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      if (start === null) start = now;
      const p = Math.min(1, (now - start) / durationMs);
      setVal(Math.round(target * ease(p)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, run]);
  return val;
}

export function MealScanSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<'camera' | 'analyzing' | 'result'>(
    'camera',
  );
  const [photo, setPhoto] = useState<string | null>(null); // dataURL figé
  const [error, setError] = useState<string | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [streamTick, setStreamTick] = useState(0);

  const [items, setItems] = useState<ScanItem[]>([]);
  const [day, setDay] = useState<DayState | null>(null);
  const [serverPhoto, setServerPhoto] = useState<string | null>(null);
  const [desc, setDesc] = useState<string>('');
  const [meal, setMeal] = useState<MealCategory>('lunch');
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamReady(false);
  }, []);

  // Ouvre la caméra arrière au montage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Caméra non disponible sur ce navigateur.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCamReady(true);
        setStreamTick((n) => n + 1);
      } catch (e) {
        const err = e as { name?: string; message?: string };
        setError(
          err?.name === 'NotAllowedError'
            ? 'Caméra refusée. Utilise « Galerie », ou autorise la caméra dans les réglages.'
            : err?.message || 'Caméra indisponible — utilise « Galerie ».',
        );
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [stopStream]);

  // Attache le flux au <video> APRÈS son montage visible (srcObject sur un
  // élément caché ne peint pas sur Android/iOS — cf. camera-test).
  useEffect(() => {
    if (!camReady) return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) return;
    v.srcObject = s;
    const tryPlay = () => v.play().catch(() => {});
    v.onloadedmetadata = tryPlay;
    tryPlay();
  }, [camReady, streamTick]);

  // Verrouille le scroll du body.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Analyse Vision + parse Ciqual + état du jour à partir d'un blob image.
  const analyze = useCallback(async (file: File, frozenDataUrl: string) => {
    // Flux gardé vivant (la photo figée le masque) → « Reprendre » immédiat.
    setPhoto(frozenDataUrl);
    setPhase('analyzing');
    setError(null);
    try {
      const cat = defaultMealForHour(new Date());
      setMeal(cat);

      // État du jour en parallèle (objectifs + totaux) — n'impacte pas la
      // latence de l'analyse.
      const dayPromise = fetch('/api/nutrition/today')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      const compressed = await compressImage(file, {
        maxDim: 1280,
        quality: 0.8,
        skipBelowKB: 150,
      });

      const fd = new FormData();
      fd.append('photo', compressed);
      const dRes = await fetch('/api/nutrition/describe-meal', {
        method: 'POST',
        body: fd,
      });
      const dData = await dRes.json();
      if (!dRes.ok) {
        setError(dData?.error || 'Analyse impossible. Réessaie.');
        setPhase('camera');
        setPhoto(null);
        setStreamTick((n) => n + 1);
        return;
      }
      const description =
        typeof dData.description === 'string' ? dData.description.trim() : '';
      const photoUrl =
        typeof dData.photoUrl === 'string' ? dData.photoUrl : null;
      setDesc(description.slice(0, 500));
      setServerPhoto(photoUrl);

      const pRes = await fetch('/api/nutrition/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: description || 'un plat' }),
      });
      const pData = await pRes.json();
      if (!pRes.ok) {
        routeToDetail(cat, description, photoUrl);
        return;
      }
      const parsed: ScanItem[] = Array.isArray(pData.items)
        ? pData.items.map((it: Record<string, unknown>) => ({
            label: String(it.label ?? ''),
            portions: Number(it.portions) || 1,
            approxGrams: Number(it.approxGrams) || 0,
            match:
              it.match && typeof it.match === 'object'
                ? {
                    alimCode: Number(
                      (it.match as { alimCode: number }).alimCode,
                    ),
                  }
                : null,
            kcalPerPortion:
              typeof it.kcalPerPortion === 'number' ? it.kcalPerPortion : null,
            proteinsPerPortion:
              typeof it.proteinsPerPortion === 'number'
                ? it.proteinsPerPortion
                : null,
            lipidsPerPortion:
              typeof it.lipidsPerPortion === 'number'
                ? it.lipidsPerPortion
                : null,
            carbsPerPortion:
              typeof it.carbsPerPortion === 'number'
                ? it.carbsPerPortion
                : null,
          }))
        : [];

      const hasKcal = parsed.some((it) => it.kcalPerPortion != null);
      if (parsed.length === 0 || !hasKcal) {
        routeToDetail(cat, description, photoUrl);
        return;
      }

      // Récupère l'état du jour (pour la projection des anneaux).
      const dayData = await dayPromise;
      if (
        dayData &&
        typeof dayData === 'object' &&
        dayData.target &&
        dayData.totals
      ) {
        setDay({
          target: {
            dailyProteinsG: dayData.target.dailyProteinsG ?? null,
            dailyLipidsG: dayData.target.dailyLipidsG ?? null,
            dailyCarbsG: dayData.target.dailyCarbsG ?? null,
          },
          totals: {
            proteinsG: Number(dayData.totals.proteinsG) || 0,
            lipidsG: Number(dayData.totals.lipidsG) || 0,
            carbsG: Number(dayData.totals.carbsG) || 0,
          },
        });
      }

      setItems(parsed);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur pendant l’analyse.');
      setPhase('camera');
      setPhoto(null);
      setStreamTick((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function routeToDetail(
    cat: MealCategory,
    description: string,
    photoUrl: string | null,
  ) {
    const params = new URLSearchParams();
    if (description) params.set('desc', description.slice(0, 500));
    if (photoUrl) params.set('photo', photoUrl);
    params.set('from', window.location.pathname + window.location.search);
    stopStream();
    router.push(`/mes-calories/${MEAL_URL_SLUG[cat]}?${params.toString()}`);
  }

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setError('Image pas encore prête — réessaie dans une seconde.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Capture impossible — réessaie.');
          return;
        }
        analyze(new File([blob], 'repas.jpg', { type: 'image/jpeg' }), dataUrl);
      },
      'image/jpeg',
      0.9,
    );
  }

  function onGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => analyze(f, reader.result as string);
    reader.readAsDataURL(f);
  }

  function retake() {
    setPhoto(null);
    setItems([]);
    setDay(null);
    setError(null);
    setPhase('camera');
    setStreamTick((n) => n + 1);
  }

  // Totaux du repas.
  const totalKcal = Math.round(
    items.reduce((s, it) => s + (it.kcalPerPortion ?? 0) * it.portions, 0),
  );
  const mealP = items.reduce(
    (s, it) => s + (it.proteinsPerPortion ?? 0) * it.portions,
    0,
  );
  const mealL = items.reduce(
    (s, it) => s + (it.lipidsPerPortion ?? 0) * it.portions,
    0,
  );
  const mealC = items.reduce(
    (s, it) => s + (it.carbsPerPortion ?? 0) * it.portions,
    0,
  );
  // Projection « jour après ajout » = déjà mangé + ce repas.
  const projP = (day?.totals.proteinsG ?? 0) + mealP;
  const projL = (day?.totals.lipidsG ?? 0) + mealL;
  const projC = (day?.totals.carbsG ?? 0) + mealC;

  const animatedTotal = useCountUp(totalKcal, 950, phase === 'result');

  async function handleAdd() {
    if (logging || items.length === 0) return;
    setLogging(true);
    setError(null);
    try {
      const entries = items
        .filter((it) => it.kcalPerPortion != null)
        .map((it) => ({
          source: it.match ? ('ciqual' as const) : ('free' as const),
          sourceRefId: it.match ? String(it.match.alimCode) : null,
          label: it.label,
          kcal: it.kcalPerPortion as number,
          proteinsG: it.proteinsPerPortion,
          lipidsG: it.lipidsPerPortion,
          carbsG: it.carbsPerPortion,
          portions: it.portions,
        }));
      if (entries.length === 0) {
        setError('Aucun aliment chiffré à ajouter.');
        return;
      }
      const res = await fetch('/api/nutrition/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries,
          mealCategory: meal,
          photoUrl: serverPhoto,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error || 'Enregistrement impossible.');
        return;
      }
      window.dispatchEvent(new CustomEvent('nutrition-log-updated'));
      void fetch('/api/nutrition/karine-tip', { method: 'POST' }).catch(
        () => {},
      );
      setLogged(true);
      stopStream();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur d’enregistrement.');
    } finally {
      setLogging(false);
    }
  }

  return (
    <div className="meal-scan-root fixed inset-0 z-[200] flex flex-col bg-cream">
      {/* Fermer */}
      {!logged && (
        <button
          type="button"
          onClick={() => {
            stopStream();
            onClose();
          }}
          aria-label="Fermer"
          className="absolute left-4 top-4 z-30 grid size-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm"
        >
          <X className="size-5" />
        </button>
      )}

      {/* ── HAUT : caméra / photo ───────────────────────────────── */}
      <div className="relative h-[44vh] shrink-0 overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${
            phase === 'camera' && camReady && !photo ? '' : 'hidden'
          }`}
        />
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="h-full w-full object-cover" />
        )}
        {phase === 'camera' && !camReady && !error && (
          <div className="grid h-full place-items-center text-sm text-white/70">
            Ouverture de la caméra…
          </div>
        )}

        {/* Cadre blanc de cadrage */}
        {phase === 'camera' && camReady && (
          <div className="pointer-events-none absolute inset-5 rounded-2xl border-2 border-white/80 meal-scan-frame" />
        )}

        {/* Scan rose pendant l'analyse */}
        {phase === 'analyzing' && (
          <div className="pointer-events-none absolute inset-0">
            <div className="meal-scan-veil absolute inset-0" />
            <div className="meal-scan-beam absolute inset-x-0" />
            <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-2">
              <div className="meal-scan-dots flex gap-1.5">
                <span />
                <span />
                <span />
              </div>
              <p className="text-sm font-semibold text-white drop-shadow">
                Analyse de ton plat…
              </p>
            </div>
          </div>
        )}

        {/* Résultat : total qui défile + anneaux de projection */}
        {phase === 'result' && (
          <>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-black/10 to-black/65" />
            <div className="absolute inset-x-0 top-5 flex flex-col items-center">
              <p className="tabular-nums text-5xl font-extrabold leading-none text-white drop-shadow-lg">
                {animatedTotal}
              </p>
              <p className="mt-1 text-sm font-semibold text-white/90 drop-shadow">
                kcal · ton {MEAL_LABEL[meal]}
              </p>
            </div>
            {/* Anneaux P / L / G — projection du jour après ajout */}
            <div className="absolute inset-x-0 bottom-3 flex justify-center">
              <div className="flex items-center gap-2 rounded-2xl bg-white/85 px-4 py-2 shadow-lg backdrop-blur-sm">
                <MacroRing
                  kind="protein"
                  current={projP}
                  target={day?.target.dailyProteinsG ?? null}
                />
                <MacroRing
                  kind="lipid"
                  current={projL}
                  target={day?.target.dailyLipidsG ?? null}
                />
                <MacroRing
                  kind="carbs"
                  current={projC}
                  target={day?.target.dailyCarbsG ?? null}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── BAS : actions caméra OU vignettes résultat ──────────── */}
      {phase === 'camera' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
          <div className="flex items-center justify-center gap-10">
            <label
              className="grid size-12 cursor-pointer place-items-center rounded-full bg-white text-coral shadow-sm ring-1 ring-cream"
              aria-label="Choisir une photo dans la galerie"
            >
              <ImageIcon className="size-5" />
              <input
                type="file"
                accept="image/*"
                onChange={onGallery}
                className="sr-only"
              />
            </label>
            {/* Déclencheur rouge style appareil photo */}
            <button
              type="button"
              onClick={capture}
              disabled={!camReady}
              aria-label="Prendre la photo du plat"
              className="grid size-[4.75rem] place-items-center rounded-full bg-white shadow-lg ring-4 ring-coral/30 transition active:scale-95 disabled:opacity-50"
            >
              <span className="size-[3.6rem] rounded-full bg-red-500 ring-2 ring-white" />
            </button>
            <span className="size-12" />
          </div>
          <p className="text-center text-sm font-medium text-ink-soft">
            Cadre ton plat dans le cadre blanc, puis appuie pour l’analyser.
          </p>
        </div>
      )}

      {phase === 'analyzing' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-base font-bold text-ink">On regarde ton assiette…</p>
          <p className="text-sm text-ink-soft">
            Reconnaissance des aliments et calcul des calories.
          </p>
        </div>
      )}

      {phase === 'result' && !logged && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-coral-dark">
              {items.length} aliment{items.length > 1 ? 's' : ''} détecté
              {items.length > 1 ? 's' : ''}
            </p>
            <ul className="space-y-2">
              {items.map((it, i) => {
                const itemKcal =
                  it.kcalPerPortion != null
                    ? Math.round(it.kcalPerPortion * it.portions)
                    : null;
                return (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-cream"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold capitalize text-ink">
                        {it.label}
                      </span>
                      <span className="text-xs text-ink-soft">
                        {it.portions > 1 ? `${it.portions} portions · ` : ''}
                        {it.approxGrams > 0 ? `${it.approxGrams} g` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-coral/10 px-2.5 py-1 text-sm font-bold text-coral-dark">
                      {itemKcal != null ? `${itemKcal} kcal` : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
            {error && (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="shrink-0 border-t border-cream bg-cream/60 px-4 pb-6 pt-3">
            <button
              type="button"
              onClick={handleAdd}
              disabled={logging}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-full bg-coral px-5 py-3 text-base font-bold text-white shadow-md transition active:scale-[0.98] disabled:opacity-70"
            >
              {logging ? (
                <>
                  <span className="meal-scan-spin size-4 rounded-full border-2 border-white/40 border-t-white" />
                  Enregistrement…
                </>
              ) : (
                <>
                  <Check className="size-5" />
                  Ajouter à mon {MEAL_LABEL[meal]}
                </>
              )}
            </button>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => routeToDetail(meal, desc, serverPhoto)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-sm font-semibold text-coral-dark"
              >
                <Pencil className="size-4" />
                Ajuster en détail
              </button>
              <button
                type="button"
                onClick={retake}
                className="flex items-center gap-1.5 px-2 py-1.5 text-sm font-semibold text-ink-soft"
              >
                <RotateCcw className="size-4" />
                Reprendre
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUCCÈS */}
      {logged && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-white">
          <div className="meal-scan-success grid size-24 place-items-center rounded-full bg-coral/10">
            <Check className="size-12 text-coral" strokeWidth={3} />
          </div>
          <p className="text-lg font-bold text-ink">
            Ajouté à ton {MEAL_LABEL[meal]} !
          </p>
          <p className="text-sm text-ink-soft">
            <span className="tabular-nums">{animatedTotal}</span> kcal
            enregistrées
          </p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => router.push('/mes-calories')}
              className="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white shadow-md"
            >
              Voir mon journal
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-cream px-5 py-2.5 text-sm font-semibold text-ink-soft"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Erreur (phases caméra/analyse) */}
      {error && phase !== 'result' && (
        <div className="absolute inset-x-0 top-[44vh] z-30 mx-auto max-w-sm -translate-y-1/2 px-5">
          <div className="flex items-start gap-2 rounded-xl bg-white px-3 py-2 text-sm text-ink shadow-lg">
            <RotateCcw className="mt-0.5 size-4 shrink-0 text-coral" />
            <span>{error}</span>
          </div>
        </div>
      )}

      <style>{`
        /* Cadre blanc : léger souffle pour inviter au cadrage */
        .meal-scan-frame { animation: meal-scan-breathe 2.4s ease-in-out infinite; }
        @keyframes meal-scan-breathe {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; }
        }

        /* Voile + ligne de balayage ROSE pendant l'analyse */
        .meal-scan-veil {
          background: radial-gradient(120% 80% at 50% 40%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 100%);
        }
        .meal-scan-beam {
          height: 35%;
          top: -35%;
          background: linear-gradient(
            to bottom,
            rgba(226, 120, 141, 0) 0%,
            rgba(226, 120, 141, 0.20) 60%,
            rgba(253, 246, 239, 0.55) 100%
          );
          border-bottom: 0.12rem solid rgba(253, 246, 239, 0.92);
          box-shadow: 0 0.25rem 1.5rem rgba(226, 120, 141, 0.5);
          animation: meal-scan-sweep 1.6s cubic-bezier(0.45, 0, 0.55, 1) infinite;
        }
        @keyframes meal-scan-sweep {
          0% { top: -35%; }
          100% { top: 100%; }
        }

        .meal-scan-dots span {
          display: block; width: 0.5rem; height: 0.5rem;
          border-radius: 9999px; background: #fff;
          animation: meal-scan-bounce 1s ease-in-out infinite;
        }
        .meal-scan-dots span:nth-child(2) { animation-delay: 0.15s; }
        .meal-scan-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes meal-scan-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-0.35rem); opacity: 1; }
        }

        .meal-scan-success { animation: meal-scan-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes meal-scan-pop {
          0% { transform: scale(0.4); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        .meal-scan-spin { animation: meal-scan-rotate 0.7s linear infinite; }
        @keyframes meal-scan-rotate { to { transform: rotate(360deg); } }

        @media (prefers-reduced-motion: reduce) {
          .meal-scan-frame, .meal-scan-beam, .meal-scan-dots span,
          .meal-scan-success, .meal-scan-spin { animation: none; }
        }
      `}</style>
    </div>
  );
}
