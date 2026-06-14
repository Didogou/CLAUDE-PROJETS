'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ImageIcon, RotateCcw } from 'lucide-react';
import {
  MEAL_URL_SLUG,
  defaultMealForHour,
} from '@/components/nutrition/CalorieCounterSheetV2';
import { compressImage } from '@/lib/compress-image';

/**
 * Phase 3 — Expérience « scan repas » in-app (effet wouah).
 *
 * Remplace à terme le flux natif `<input capture>` de CameraFAB :
 *   1. Caméra LIVE plein écran dans la page (getUserMedia, validé Android+iOS
 *      2026-06-14 — nécessitait Permissions-Policy camera=(self)).
 *   2. L'utilisatrice cadre le plat (réticule coral) puis déclenche.
 *   3. La photo se fige + animation de scan brandée (ligne qui balaie +
 *      coins lumineux) PENDANT l'appel Vision (compression → describe-meal).
 *   4. Route vers /mes-calories/<slug>?desc=&photo=&from= — la page de
 *      validation existante prend le relais (preview + parse).
 *
 * Backend INCHANGÉ (Mistral Vision → Ciqual). Le wouah est 100% côté UI,
 * en CSS keyframes thémées (aucune dépendance ajoutée).
 *
 * Fallback galerie conservé pour les appareils sans caméra exploitable.
 */
export function MealScanSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<'camera' | 'analyzing'>('camera');
  const [photo, setPhoto] = useState<string | null>(null); // dataURL figé
  const [error, setError] = useState<string | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [streamTick, setStreamTick] = useState(0);

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
        // NotAllowedError → permission refusée ; on bascule sur la galerie.
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

  // Attache le flux au <video> APRÈS son montage visible (cf. camera-test :
  // assigner srcObject à un élément caché ne peint pas sur Android/iOS).
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

  // Lance l'analyse Vision à partir d'un blob image (capture OU galerie).
  const analyze = useCallback(
    async (file: File, frozenDataUrl: string) => {
      // On NE coupe PAS le flux ici : la photo figée le masque visuellement,
      // et le garder vivant permet un retour caméra immédiat si l'analyse
      // échoue (sinon il faudrait ré-ouvrir getUserMedia). Le flux est arrêté
      // au démontage (navigation succès) ou à la fermeture manuelle.
      setPhoto(frozenDataUrl);
      setPhase('analyzing');
      setError(null);
      try {
        const cat = defaultMealForHour(new Date());
        const slug = MEAL_URL_SLUG[cat];

        // Compression client OBLIGATOIRE avant upload (règle projet).
        const compressed = await compressImage(file, {
          maxDim: 1280,
          quality: 0.8,
          skipBelowKB: 150,
        });

        const fd = new FormData();
        fd.append('photo', compressed);
        const res = await fetch('/api/nutrition/describe-meal', {
          method: 'POST',
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error || 'Analyse impossible. Réessaie.');
          setPhase('camera');
          setPhoto(null);
          setStreamTick((n) => n + 1);
          return;
        }

        const params = new URLSearchParams();
        if (typeof data.description === 'string' && data.description.trim()) {
          params.set('desc', data.description.trim().slice(0, 500));
        }
        if (typeof data.photoUrl === 'string' && data.photoUrl) {
          params.set('photo', data.photoUrl);
        }
        const fromPath = window.location.pathname + window.location.search;
        params.set('from', fromPath);
        router.push(`/mes-calories/${slug}?${params.toString()}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur pendant l’analyse.');
        setPhase('camera');
        setPhoto(null);
        setStreamTick((n) => n + 1); // relance play() (flux toujours vivant)
      }
    },
    [router],
  );

  // Déclencheur : fige la frame courante dans un canvas → blob → analyse.
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
        const file = new File([blob], 'repas.jpg', { type: 'image/jpeg' });
        analyze(file, dataUrl);
      },
      'image/jpeg',
      0.9,
    );
  }

  // Fallback galerie (appareils sans caméra exploitable).
  function onGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => analyze(f, reader.result as string);
    reader.readAsDataURL(f);
  }

  return (
    <div className="meal-scan-root fixed inset-0 z-[200] flex flex-col bg-black">
      {/* Barre haut : fermer */}
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
          {phase === 'analyzing' ? 'Analyse en cours…' : 'Cadre ton plat'}
        </span>
        <span className="size-10" />
      </div>

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
      </div>

      {/* Barre bas : actions (masquée pendant l'analyse) */}
      {phase === 'camera' && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-8 px-6 pb-8 pt-4">
          {/* Galerie */}
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

          {/* Déclencheur */}
          <button
            type="button"
            onClick={capture}
            disabled={!camReady}
            aria-label="Prendre la photo du plat"
            className="grid size-[4.5rem] place-items-center rounded-full bg-white ring-4 ring-white/40 transition active:scale-95 disabled:opacity-50"
          >
            <span className="size-[3.5rem] rounded-full bg-coral ring-2 ring-white" />
          </button>

          {/* Espace symétrique (réservé à un futur flip caméra) */}
          <span className="size-12" />
        </div>
      )}

      {/* Erreur (au-dessus de la barre d'actions) */}
      {error && (
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

        /* Voile sombre + ligne de balayage pendant l'analyse */
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
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 9999px;
          background: #fff;
          animation: meal-scan-bounce 1s ease-in-out infinite;
        }
        .meal-scan-dots span:nth-child(2) { animation-delay: 0.15s; }
        .meal-scan-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes meal-scan-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-0.35rem); opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .meal-scan-reticle,
          .meal-scan-beam,
          .meal-scan-dots span { animation: none; }
        }
      `}</style>
    </div>
  );
}
