'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ImageIcon, Check, Pencil, RotateCcw } from 'lucide-react';
import {
  MEAL_URL_SLUG,
  defaultMealForHour,
  type MealCategory,
} from '@/components/nutrition/CalorieCounterSheetV2';
import { compressImage } from '@/lib/compress-image';

/**
 * Phase 3 — Expérience « scan repas » in-app (effet wouah, single-page).
 *
 *   1. Caméra LIVE plein écran (getUserMedia, validé Android+iOS 2026-06-14 ;
 *      nécessitait Permissions-Policy camera=(self)).
 *   2. Cadrage (réticule coral) → déclencheur.
 *   3. Photo figée + animation de scan brandée PENDANT l'analyse
 *      (compression → describe-meal Vision → parse Ciqual). Backend INCHANGÉ.
 *   4. Le résultat REMONTE du bas en vignette (plat + total kcal) — on NE
 *      change PAS de page :
 *        • « Ajouter à mon <repas> » → POST /api/nutrition/log (kcal par
 *          portion, convention CalorieCounterSheetV2) → succès animé → close.
 *        • « Ajuster en détail » → route vers /mes-calories/<slug> (fiche
 *          riche existante : choix candidat, accompagnements, portions P/M/G).
 *
 * Le wouah est 100% CSS keyframes thémées (aucune dépendance ajoutée).
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

const MEAL_LABEL: Record<MealCategory, string> = {
  breakfast: 'petit-déjeuner',
  lunch: 'déjeuner',
  snack: 'goûter',
  dinner: 'dîner',
};

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

  // Résultat de l'analyse (vignette).
  const [items, setItems] = useState<ScanItem[]>([]);
  const [serverPhoto, setServerPhoto] = useState<string | null>(null); // path Storage
  const [desc, setDesc] = useState<string>(''); // description Vision (pour « Ajuster »)
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
            ? 'Caméra refusée. Utilise « Galerie » ci-dessous, ou autorise la caméra dans les réglages.'
            : err?.message || 'Caméra indisponible — utilise « Galerie ».',
        );
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [stopStream]);

  // Attache le flux au <video> APRÈS son montage visible (assigner srcObject
  // à un élément caché ne peint pas sur Android/iOS — cf. camera-test).
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

  // Verrouille le scroll du body tant que la feuille est ouverte.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Analyse Vision + parse Ciqual à partir d'un blob image (capture/galerie).
  const analyze = useCallback(async (file: File, frozenDataUrl: string) => {
    // On NE coupe PAS le flux : la photo figée le masque, et le garder vivant
    // permet « Reprendre » / un retour caméra immédiat sans ré-ouvrir.
    setPhoto(frozenDataUrl);
    setPhase('analyzing');
    setError(null);
    try {
      const cat = defaultMealForHour(new Date());
      setMeal(cat);

      // Compression client OBLIGATOIRE avant upload (règle projet).
      const compressed = await compressImage(file, {
        maxDim: 1280,
        quality: 0.8,
        skipBelowKB: 150,
      });

      // 1) Vision → description textuelle + photo persistée.
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

      // 2) Parse → aliments + kcal Ciqual (même endpoint que la saisie texte).
      const pRes = await fetch('/api/nutrition/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: description || 'un plat' }),
      });
      const pData = await pRes.json();
      if (!pRes.ok) {
        // Repli : on bascule sur la fiche détaillée existante avec la desc.
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
                ? { alimCode: Number((it.match as { alimCode: number }).alimCode) }
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
        // Rien d'exploitable → on laisse l'utilisatrice préciser dans la fiche.
        routeToDetail(cat, description, photoUrl);
        return;
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

  // Route vers la fiche détaillée existante (repli / ajustement fin).
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

  // Déclencheur : fige la frame courante → blob → analyse.
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

  // Fallback galerie.
  function onGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => analyze(f, reader.result as string);
    reader.readAsDataURL(f);
  }

  // « Reprendre » : retour caméra (flux toujours vivant).
  function retake() {
    setPhoto(null);
    setItems([]);
    setError(null);
    setPhase('camera');
    setStreamTick((n) => n + 1);
  }

  // Total kcal affiché = somme(kcalPerPortion × portions).
  const totalKcal = Math.round(
    items.reduce(
      (sum, it) => sum + (it.kcalPerPortion ?? 0) * it.portions,
      0,
    ),
  );

  // « Ajouter » : log direct (kcal PAR PORTION + portions séparé — convention
  // CalorieCounterSheetV2 ; surtout NE PAS multiplier ici).
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
        body: JSON.stringify({ entries, mealCategory: meal, photoUrl: serverPhoto }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error || 'Enregistrement impossible.');
        return;
      }
      // Réveille le reste de l'app (journal, anneaux) + conseil Karine.
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
    <div className="meal-scan-root fixed inset-0 z-[200] flex flex-col bg-black">
      {/* Barre haut : fermer */}
      {!logged && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4">
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            aria-label="Fermer"
            className="grid size-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm"
          >
            <X className="size-5" />
          </button>
          <span className="rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
            {phase === 'analyzing'
              ? 'Analyse en cours…'
              : phase === 'result'
                ? 'Ton plat'
                : 'Cadre ton plat'}
          </span>
          <span className="size-10" />
        </div>
      )}

      {/* Zone visuelle : vidéo live OU photo figée */}
      <div className="relative flex-1 overflow-hidden">
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

        {/* Réticule de cadrage (phase caméra) */}
        {phase === 'camera' && camReady && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="meal-scan-reticle relative h-[68%] w-[82%] max-w-[26rem] rounded-[1.75rem]">
              <span className="meal-scan-corner meal-scan-corner--tl" />
              <span className="meal-scan-corner meal-scan-corner--tr" />
              <span className="meal-scan-corner meal-scan-corner--bl" />
              <span className="meal-scan-corner meal-scan-corner--br" />
            </div>
          </div>
        )}

        {/* Overlay SCAN brandé (phase analyse) */}
        {phase === 'analyzing' && (
          <div className="pointer-events-none absolute inset-0">
            <div className="meal-scan-veil absolute inset-0" />
            <div className="meal-scan-beam absolute inset-x-0" />
            <div className="absolute inset-x-0 bottom-[18%] flex flex-col items-center gap-2">
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

        {/* Voile doux derrière la vignette résultat */}
        {phase === 'result' && (
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-black/70" />
        )}
      </div>

      {/* Barre bas : actions caméra */}
      {phase === 'camera' && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-8 px-6 pb-8 pt-4">
          <label
            className="grid size-12 cursor-pointer place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm"
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
          <button
            type="button"
            onClick={capture}
            disabled={!camReady}
            aria-label="Prendre la photo du plat"
            className="grid size-[4.5rem] place-items-center rounded-full bg-white ring-4 ring-white/40 transition active:scale-95 disabled:opacity-50"
          >
            <span className="size-[3.5rem] rounded-full bg-coral ring-2 ring-white" />
          </button>
          <span className="size-12" />
        </div>
      )}

      {/* VIGNETTE RÉSULTAT (remonte du bas) */}
      {phase === 'result' && !logged && (
        <div className="meal-scan-result absolute inset-x-0 bottom-0 z-30 max-h-[78%] overflow-y-auto rounded-t-[1.75rem] bg-white px-5 pb-7 pt-3 shadow-2xl">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-cream" />

          <div className="mb-3 flex items-center gap-3">
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo}
                alt=""
                className="size-14 shrink-0 rounded-xl object-cover ring-1 ring-cream"
              />
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-coral-dark">
                Ton {MEAL_LABEL[meal]}
              </p>
              <p className="text-sm text-ink-soft">
                {items.length} aliment{items.length > 1 ? 's' : ''} détecté
                {items.length > 1 ? 's' : ''}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-2xl font-extrabold leading-none text-coral">
                {totalKcal}
              </p>
              <p className="text-[0.7rem] font-semibold text-ink-soft">kcal</p>
            </div>
          </div>

          {/* Liste des aliments détectés */}
          <ul className="mb-4 divide-y divide-cream rounded-2xl bg-cream/40 px-3">
            {items.map((it, i) => {
              const itemKcal =
                it.kcalPerPortion != null
                  ? Math.round(it.kcalPerPortion * it.portions)
                  : null;
              return (
                <li key={i} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium capitalize text-ink">
                    {it.label}
                  </span>
                  <span className="shrink-0 text-xs text-ink-soft">
                    {it.portions > 1 ? `${it.portions}× ` : ''}
                    {it.approxGrams > 0 ? `${it.approxGrams} g` : ''}
                  </span>
                  <span className="w-14 shrink-0 text-right text-sm font-semibold text-coral-dark">
                    {itemKcal != null ? `${itemKcal}` : '—'}
                  </span>
                </li>
              );
            })}
          </ul>

          {error && (
            <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Actions */}
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
      )}

      {/* SUCCÈS — coche animée puis fermeture */}
      {logged && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-white">
          <div className="meal-scan-success grid size-24 place-items-center rounded-full bg-coral/10">
            <Check className="size-12 text-coral" strokeWidth={3} />
          </div>
          <p className="text-lg font-bold text-ink">Ajouté à ton {MEAL_LABEL[meal]} !</p>
          <p className="text-sm text-ink-soft">{totalKcal} kcal enregistrées</p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => {
                router.push('/mes-calories');
              }}
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
        <div className="absolute inset-x-0 bottom-28 z-30 mx-auto max-w-sm px-5">
          <div className="flex items-start gap-2 rounded-xl bg-white px-3 py-2 text-sm text-ink shadow-lg">
            <RotateCcw className="mt-0.5 size-4 shrink-0 text-coral" />
            <span>{error}</span>
          </div>
        </div>
      )}

      <style>{`
        /* Réticule : 4 coins coral lumineux + léger souffle.
           Couleurs = tokens de marque Karine (coral #e2788d, cream #fdf6ef). */
        .meal-scan-corner {
          position: absolute;
          width: 1.75rem;
          height: 1.75rem;
          border: 0.18rem solid var(--color-coral, #e2788d);
          filter: drop-shadow(0 0 0.35rem rgba(226, 120, 141, 0.7));
        }
        .meal-scan-corner--tl { top: -0.1rem; left: -0.1rem; border-right: 0; border-bottom: 0; border-top-left-radius: 1.25rem; }
        .meal-scan-corner--tr { top: -0.1rem; right: -0.1rem; border-left: 0; border-bottom: 0; border-top-right-radius: 1.25rem; }
        .meal-scan-corner--bl { bottom: -0.1rem; left: -0.1rem; border-right: 0; border-top: 0; border-bottom-left-radius: 1.25rem; }
        .meal-scan-corner--br { bottom: -0.1rem; right: -0.1rem; border-left: 0; border-top: 0; border-bottom-right-radius: 1.25rem; }
        .meal-scan-reticle { animation: meal-scan-breathe 2.4s ease-in-out infinite; }
        @keyframes meal-scan-breathe {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.015); opacity: 1; }
        }

        /* Voile + ligne de balayage pendant l'analyse */
        .meal-scan-veil {
          background: radial-gradient(120% 80% at 50% 40%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 100%);
        }
        .meal-scan-beam {
          height: 35%;
          top: -35%;
          background: linear-gradient(
            to bottom,
            rgba(226, 120, 141, 0) 0%,
            rgba(226, 120, 141, 0.18) 60%,
            rgba(253, 246, 239, 0.55) 100%
          );
          border-bottom: 0.12rem solid rgba(253, 246, 239, 0.92);
          box-shadow: 0 0.25rem 1.5rem rgba(226, 120, 141, 0.45);
          animation: meal-scan-sweep 1.7s cubic-bezier(0.45, 0, 0.55, 1) infinite;
        }
        @keyframes meal-scan-sweep {
          0% { top: -35%; }
          100% { top: 100%; }
        }

        /* Points de progression */
        .meal-scan-dots span {
          display: block;
          width: 0.5rem; height: 0.5rem;
          border-radius: 9999px; background: #fff;
          animation: meal-scan-bounce 1s ease-in-out infinite;
        }
        .meal-scan-dots span:nth-child(2) { animation-delay: 0.15s; }
        .meal-scan-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes meal-scan-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-0.35rem); opacity: 1; }
        }

        /* Vignette résultat : remonte du bas */
        .meal-scan-result { animation: meal-scan-rise 0.42s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes meal-scan-rise {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        /* Succès : coche qui éclot */
        .meal-scan-success { animation: meal-scan-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes meal-scan-pop {
          0% { transform: scale(0.4); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        .meal-scan-spin { animation: meal-scan-rotate 0.7s linear infinite; }
        @keyframes meal-scan-rotate { to { transform: rotate(360deg); } }

        @media (prefers-reduced-motion: reduce) {
          .meal-scan-reticle,
          .meal-scan-beam,
          .meal-scan-dots span,
          .meal-scan-result,
          .meal-scan-success,
          .meal-scan-spin { animation: none; }
        }
      `}</style>
    </div>
  );
}
