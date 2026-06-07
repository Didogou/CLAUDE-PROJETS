'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, RotateCcw } from 'lucide-react';

/**
 * Éditeur visuel de position + taille de la fée Karine sur /recettes-v2.
 *
 * Permet à Karine/Didier d'ajuster en LIVE la position et la taille de
 * la fée (drag pour déplacer, handle bas-droite pour redimensionner),
 * puis de copier les valeurs finales pour les hardcoder dans le code.
 *
 * Stocke les valeurs en `localStorage` (persistance entre rechargements)
 * + affiche un panneau flottant avec les valeurs courantes + boutons
 * Copy / Reset.
 *
 * Unités utilisées (responsive) :
 *  - left  en vw   (pourcentage du viewport, scale automatiquement)
 *  - top   en px   (relatif au haut de la page)
 *  - width en vw   (idem)
 *
 * Une fois les valeurs validées, remplacer ce composant dans page.tsx
 * par un simple <img> avec les valeurs hardcodées en CSS.
 *
 * NOTE : composant POC pour /recettes-v2 uniquement. À supprimer une
 * fois la position fixée.
 */

type FeeConfig = {
  leftVw: number;
  topPx: number;
  widthVw: number;
};

const DEFAULT: FeeConfig = { leftVw: 1, topPx: 4, widthVw: 18 };
const STORAGE_KEY = 'recettes-v2-fee-position';

export function FeeEditor() {
  const [config, setConfig] = useState<FeeConfig>(DEFAULT);
  const [mounted, setMounted] = useState(false);
  const dragRef = useRef<{
    kind: 'drag' | 'resize';
    startX: number;
    startY: number;
    startConfig: FeeConfig;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  // Hydratation : load depuis localStorage si présent
  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as FeeConfig;
        if (
          typeof parsed.leftVw === 'number' &&
          typeof parsed.topPx === 'number' &&
          typeof parsed.widthVw === 'number'
        ) {
          setConfig(parsed);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  function startDrag(e: React.PointerEvent, kind: 'drag' | 'resize') {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      startConfig: config,
    };
  }

  function handleMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const vwToPx = window.innerWidth / 100;

    if (dragRef.current.kind === 'drag') {
      setConfig({
        ...dragRef.current.startConfig,
        leftVw: Math.max(
          0,
          dragRef.current.startConfig.leftVw + dx / vwToPx,
        ),
        topPx: Math.max(0, dragRef.current.startConfig.topPx + dy),
      });
    } else {
      // resize horizontal : dx augmente la largeur
      setConfig({
        ...dragRef.current.startConfig,
        widthVw: Math.max(
          5,
          Math.min(80, dragRef.current.startConfig.widthVw + dx / vwToPx),
        ),
      });
    }
  }

  function endDrag(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* ignore */
    }
  }

  function reset() {
    setConfig(DEFAULT);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  async function copyToClipboard() {
    const snippet = `// Recettes-v2 — fée position\nleft: '${config.leftVw.toFixed(1)}vw',\ntop: '${config.topPx.toFixed(0)}px',\nwidth: '${config.widthVw.toFixed(1)}vw',`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 1500);
    } catch {
      /* ignore */
    }
  }

  if (!mounted) {
    // SSR/pre-hydratation : on rend juste l'image en position par défaut
    // (pas les handles) pour éviter le mismatch et un flash visuel.
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src="/recettes/fee.webp"
        alt=""
        aria-hidden
        className="pointer-events-none absolute z-[1]"
        style={{
          left: `${DEFAULT.leftVw}vw`,
          top: `${DEFAULT.topPx}px`,
          width: `${DEFAULT.widthVw}vw`,
        }}
      />
    );
  }

  return (
    <>
      {/* Conteneur draggable de la fée. Position absolue par rapport
          au wrapper page (relative). */}
      <div
        className="absolute z-[2] select-none touch-none"
        style={{
          left: `${config.leftVw}vw`,
          top: `${config.topPx}px`,
          width: `${config.widthVw}vw`,
          cursor: 'grab',
        }}
        onPointerDown={(e) => startDrag(e, 'drag')}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/recettes/fee.webp"
          alt=""
          aria-hidden
          draggable={false}
          className="block w-full select-none"
        />
        {/* Handle de redimensionnement coin bas-droite. */}
        <div
          onPointerDown={(e) => startDrag(e, 'resize')}
          onPointerMove={handleMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-label="Redimensionner la fée"
          className="absolute -bottom-1 -right-1 size-5 cursor-nwse-resize rounded-full bg-coral ring-2 ring-white shadow-md"
          style={{ touchAction: 'none' }}
        />
      </div>

      {/* Panneau flottant des valeurs courantes (bas-droite, au-dessus
          de la BottomNav). Visible uniquement en mode édition. */}
      <div className="fixed bottom-20 right-2 z-[100] rounded-xl bg-black/80 p-2.5 font-mono text-[0.65rem] leading-tight text-white shadow-lg backdrop-blur-sm">
        <div className="mb-1 text-[0.55rem] uppercase tracking-wider text-white/70">
          Position fée
        </div>
        <div>left: {config.leftVw.toFixed(1)}vw</div>
        <div>top: {config.topPx.toFixed(0)}px</div>
        <div>width: {config.widthVw.toFixed(1)}vw</div>
        <div className="mt-1.5 text-[0.55rem] text-white/60">
          {typeof window !== 'undefined'
            ? `vw=${window.innerWidth}px`
            : ''}
        </div>
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={copyToClipboard}
            className="inline-flex items-center gap-1 rounded bg-emerald-500/80 px-2 py-1 text-[0.6rem] font-bold hover:bg-emerald-500"
            title="Copier les valeurs CSS"
          >
            <Copy className="size-3" />
            {copyStatus === 'copied' ? 'Copié !' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 rounded bg-rose-500/80 px-2 py-1 text-[0.6rem] font-bold hover:bg-rose-500"
            title="Reset position"
          >
            <RotateCcw className="size-3" />
            Reset
          </button>
        </div>
      </div>
    </>
  );
}
