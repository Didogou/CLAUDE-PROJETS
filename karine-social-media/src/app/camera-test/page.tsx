'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Mini-test caméra (jetable) — valide que getUserMedia (caméra live dans
 * l'app) fonctionne sur les appareils de Karine AVANT d'investir dans la
 * Phase 3 complète. Affiche des diagnostics visibles + un fallback galerie.
 *
 * À tester : PC (Chrome/Edge), Android, et surtout iPhone — dans Safari ET
 * en PWA installée (écran d'accueil). Prérequis : HTTPS (prod) ou localhost.
 */
export default function CameraTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState('Prêt — appuie sur « Ouvrir la caméra ».');
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [diag, setDiag] = useState<string[]>([]);
  // Compteur bumpé à chaque ouverture caméra → déclenche l'effet d'attache
  // du flux au <video> APRÈS le re-render qui le rend visible.
  const [streamReady, setStreamReady] = useState(0);

  useEffect(() => {
    const d: string[] = [];
    try {
      d.push(`Contexte sécurisé (HTTPS) : ${window.isSecureContext ? 'oui ✅' : 'NON ❌'}`);
      d.push(
        `getUserMedia dispo : ${typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'oui ✅' : 'NON ❌'}`,
      );
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        // iOS Safari : flag non-standard
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      d.push(`PWA installée (standalone) : ${standalone ? 'oui' : 'non (navigateur)'}`);
      d.push(`Plateforme : ${navigator.userAgent.slice(0, 90)}`);
    } catch {
      /* noop */
    }
    setDiag(d);
    return () => stopStream();
  }, []);

  // Attache le flux au <video> APRÈS le re-render qui le rend visible.
  // Sur Android/iOS, assigner srcObject à un <video> caché (display:none)
  // ne peint pas toujours l'image. On attend donc que `active` soit vrai
  // (donc l'élément monté & visible), puis on relance play() au moment où
  // les métadonnées arrivent. Diagnostic si aucune frame après 1,5 s.
  useEffect(() => {
    if (!active) return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) return;
    v.srcObject = s;
    const tryPlay = () => {
      v.play().catch(() => {
        /* relancé au tap si le navigateur bloque l'autoplay */
      });
    };
    v.onloadedmetadata = tryPlay;
    tryPlay();
    const id = window.setTimeout(() => {
      if (!v.videoWidth) {
        setError(
          'Permission OK mais aucune image reçue (videoWidth=0). Note la ' +
            'marque + version du navigateur Android (Chrome ? Samsung ? Firefox ?).',
        );
      }
    }, 1500);
    return () => window.clearTimeout(id);
  }, [active, streamReady]);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }

  async function openCamera() {
    setError(null);
    setPhoto(null);
    setStatus('Demande de permission caméra…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia non supporté sur ce navigateur.');
      }
      // Caméra ARRIÈRE de préférence (ideal = pas bloquant si indispo).
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setActive(true);
      setStreamReady((n) => n + 1); // déclenche l'attache du flux via l'effet
      const track = stream.getVideoTracks()[0];
      setStatus(
        `Caméra active ✅ — ${track?.label || 'objectif inconnu'} (vidéo en cours…)`,
      );
    } catch (e) {
      const err = e as { name?: string; message?: string };
      setError(`${err?.name || 'Erreur'} : ${err?.message || String(e)}`);
      setStatus('Échec ❌ — utilise « Choisir dans la galerie » en repli.');
    }
  }

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setError('Flux vidéo pas encore prêt — réessaie dans 1 s.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    setPhoto(canvas.toDataURL('image/jpeg', 0.85));
    stopStream();
    setStatus('Photo capturée 📸');
  }

  function onGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(reader.result as string);
      setStatus('Image importée depuis la galerie 🖼️');
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-center text-xl font-bold text-coral-dark">
        Test caméra (Phase 3)
      </h1>

      {/* Diagnostics */}
      <ul className="rounded-xl bg-white/90 p-3 text-xs text-ink-soft shadow-sm ring-1 ring-cream">
        {diag.map((d, i) => (
          <li key={i} className="truncate">
            • {d}
          </li>
        ))}
      </ul>

      <p className="text-center text-sm font-semibold text-ink">{status}</p>
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Aperçu vidéo live OU photo capturée */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black/80">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${active ? '' : 'hidden'}`}
        />
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="capture" className="h-full w-full object-cover" />
        )}
        {!active && !photo && (
          <div className="grid h-full place-items-center text-sm text-white/70">
            Aucun flux — ouvre la caméra
          </div>
        )}
        {active && (
          <div className="pointer-events-none absolute inset-8 rounded-3xl border-2 border-white/70" />
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {!active ? (
          <button
            type="button"
            onClick={openCamera}
            className="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white shadow-md"
          >
            📷 Ouvrir la caméra
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={capture}
              className="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white shadow-md"
            >
              ◎ Prendre la photo
            </button>
            <button
              type="button"
              onClick={stopStream}
              className="rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-ink-soft ring-1 ring-cream"
            >
              Arrêter
            </button>
          </>
        )}

        <label className="cursor-pointer rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-coral ring-1 ring-coral-soft">
          🖼️ Galerie
          <input
            type="file"
            accept="image/*"
            onChange={onGallery}
            className="sr-only"
          />
        </label>

        {photo && (
          <button
            type="button"
            onClick={() => {
              setPhoto(null);
              setStatus('Prêt.');
            }}
            className="rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-ink-soft ring-1 ring-cream"
          >
            Reprendre
          </button>
        )}
      </div>

      <p className="text-center text-xs text-ink-soft">
        Teste sur PC, Android, et iPhone (Safari + PWA installée). Si « Ouvrir
        la caméra » échoue, note l'erreur affichée et utilise « Galerie ».
      </p>
    </main>
  );
}
