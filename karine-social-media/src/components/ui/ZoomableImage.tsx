/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Image qui supporte :
 *  - Pinch-to-zoom (2 doigts) sur tablette/mobile/PC tactile
 *  - Pan (1 doigt drag) quand zoomée
 *  - Double-tap pour zoomer/dézoomer
 *  - Ctrl+wheel pour zoom au trackpad/souris (PC)
 *  - Reset auto quand le composant est démonté ou la src change
 *
 * Limites : scale entre 1 et 5. Le pan est clampé pour ne pas sortir des bords
 * quand on est zoomé. Style externe via className (l'image fille remplit le wrapper).
 *
 * Usage :
 *   <ZoomableImage src="..." alt="..." className="max-h-full max-w-full object-contain" />
 *
 * Note : le wrapper a touch-action: none pour empêcher le navigateur de scroller
 * la page pendant le pinch (sinon l'effet est mauvais sur mobile). À utiliser
 * dans un conteneur dédié (modal, overlay) — pas dans une page qui scroll.
 */
export function ZoomableImage({
  src,
  alt,
  className = '',
  imgClassName = '',
  maxScale = 5,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  maxScale?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  // Pointeurs actifs : { pointerId → {x,y} }
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // État capturé au début d'un geste (distance entre 2 doigts ou position d'un seul)
  const gestureRef = useRef<{
    initialDistance: number;
    initialScale: number;
    initialMidX: number;
    initialMidY: number;
    initialTx: number;
    initialTy: number;
  } | null>(null);
  // Pour gérer le double tap (pas de gesturedouble natif)
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  // Reset quand la source change
  useEffect(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, [src]);

  /** Empêche le scroll natif du document pendant un pinch sur mobile +
   *  intercepte le wheel pour Ctrl+wheel zoom (React rend onWheel passive,
   *  donc preventDefault() depuis onWheel échoue : on attache à la main). */
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const preventTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const preventWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('touchmove', preventTouch, { passive: false });
    el.addEventListener('wheel', preventWheel, { passive: false });
    return () => {
      el.removeEventListener('touchmove', preventTouch);
      el.removeEventListener('wheel', preventWheel);
    };
  }, []);

  const clampPan = useCallback(
    (nx: number, ny: number, s: number) => {
      const el = wrapperRef.current;
      if (!el) return { x: nx, y: ny };
      const rect = el.getBoundingClientRect();
      // Demi-écart maximum entre le centre image-zoomée et le centre wrapper
      // Quand scale=1 : 0 (pas de pan). Quand scale=2 : moitié du wrapper.
      const maxX = (rect.width * (s - 1)) / 2;
      const maxY = (rect.height * (s - 1)) / 2;
      return {
        x: Math.max(-maxX, Math.min(maxX, nx)),
        y: Math.max(-maxY, Math.min(maxY, ny)),
      };
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = wrapperRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const ps = Array.from(pointersRef.current.values());
      if (ps.length === 2) {
        const [a, b] = ps;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        gestureRef.current = {
          initialDistance: Math.hypot(dx, dy),
          initialScale: scale,
          initialMidX: (a.x + b.x) / 2,
          initialMidY: (a.y + b.y) / 2,
          initialTx: tx,
          initialTy: ty,
        };
      } else if (ps.length === 1) {
        gestureRef.current = {
          initialDistance: 0,
          initialScale: scale,
          initialMidX: ps[0].x,
          initialMidY: ps[0].y,
          initialTx: tx,
          initialTy: ty,
        };
      }
    },
    [scale, tx, ty],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const ps = Array.from(pointersRef.current.values());
      const g = gestureRef.current;
      if (!g) return;

      if (ps.length === 2) {
        // Pinch-to-zoom
        const [a, b] = ps;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (g.initialDistance > 0) {
          const newScale = Math.max(
            1,
            Math.min(maxScale, g.initialScale * (dist / g.initialDistance)),
          );
          setScale(newScale);
          // Pan suivant le centre des 2 doigts
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const dpx = midX - g.initialMidX;
          const dpy = midY - g.initialMidY;
          const { x, y } = clampPan(g.initialTx + dpx, g.initialTy + dpy, newScale);
          setTx(x);
          setTy(y);
        }
      } else if (ps.length === 1 && scale > 1) {
        // Pan à 1 doigt quand zoomée
        const dpx = ps[0].x - g.initialMidX;
        const dpy = ps[0].y - g.initialMidY;
        const { x, y } = clampPan(g.initialTx + dpx, g.initialTy + dpy, scale);
        setTx(x);
        setTy(y);
      }
    },
    [clampPan, maxScale, scale],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size === 0) {
        gestureRef.current = null;
        // Détection double-tap (touch only)
        if (e.pointerType === 'touch') {
          const now = performance.now();
          const last = lastTapRef.current;
          if (last && now - last.t < 300 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
            // Toggle entre 1 et 2x
            if (scale > 1) {
              setScale(1);
              setTx(0);
              setTy(0);
            } else {
              setScale(2);
            }
            lastTapRef.current = null;
          } else {
            lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
          }
        }
      }
    },
    [scale],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      // Ctrl+wheel = zoom (convention navigateur). Sans Ctrl on laisse défiler.
      // Le preventDefault natif est géré par addEventListener({passive:false})
      // dans le useEffect plus haut (React onWheel est passive sur la plupart
      // des navigateurs et logguerait "Unable to preventDefault" sinon).
      if (!e.ctrlKey && !e.metaKey) return;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(1, Math.min(maxScale, scale * factor));
      setScale(newScale);
      if (newScale === 1) {
        setTx(0);
        setTy(0);
      } else {
        const { x, y } = clampPan(tx, ty, newScale);
        setTx(x);
        setTy(y);
      }
    },
    [clampPan, maxScale, scale, tx, ty],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Double-clic souris = même comportement que double-tap : reset / zoom 2x
      e.preventDefault();
      if (scale > 1) {
        setScale(1);
        setTx(0);
        setTy(0);
      } else {
        setScale(2);
      }
    },
    [scale],
  );

  return (
    <div
      ref={wrapperRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      className={`flex items-center justify-center overflow-hidden ${className}`}
      style={{ touchAction: 'none' }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={`block select-none ${imgClassName}`}
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transition: pointersRef.current.size > 0 ? 'none' : 'transform 200ms ease-out',
          transformOrigin: 'center center',
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
        }}
      />
    </div>
  );
}
