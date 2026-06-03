'use client';

import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';

/**
 * Explosion de cœurs déclenchée à chaque like / ajout favori.
 *
 * Usage :
 *   const [bursts, setBursts] = useHeartBurst();
 *   <button onClick={() => { setBursts(); ... }} className="relative">
 *     <HeartBurst bursts={bursts} />
 *     <Heart />
 *   </button>
 *
 * Le composant se positionne en absolute par-dessus le bouton et lance
 * 7 cœurs qui s'envolent en éventail puis disparaissent (~1.2s).
 * Auto-nettoyage du state interne.
 *
 * Pattern réutilisable partout dans l'app (like recette/sheet, favoris,
 * commentaires likés, etc.).
 */
export function HeartBurst({ bursts }: { bursts: number[] }) {
  return (
    <>
      <span className="pointer-events-none absolute inset-0">
        {bursts.map((id, i) => {
          const angleDeg = -90 + (i - 3) * 22; // éventail centré vers le haut
          const distance = 2.8 + (i % 2) * 0.5; // rem
          return (
            <Heart
              key={id}
              className="heart-burst-fly absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 fill-coral text-coral"
              strokeWidth={0}
              style={
                {
                  '--burst-x': `${Math.cos((angleDeg * Math.PI) / 180) * distance}rem`,
                  '--burst-y': `${Math.sin((angleDeg * Math.PI) / 180) * distance}rem`,
                  animationDelay: `${i * 30}ms`,
                } as React.CSSProperties
              }
            />
          );
        })}
      </span>
      {/* Animation injectée une fois (idempotent : même contenu écrasé). */}
      <style>{`
        @keyframes heart-burst-fly {
          0% {
            transform: translate(-50%, -50%) scale(0.4);
            opacity: 0;
          }
          15% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1.1);
          }
          100% {
            transform: translate(calc(-50% + var(--burst-x)), calc(-50% + var(--burst-y))) scale(0.6);
            opacity: 0;
          }
        }
        .heart-burst-fly {
          animation: heart-burst-fly 1.1s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .heart-burst-fly { animation: none; opacity: 0; }
        }
      `}</style>
    </>
  );
}

/**
 * Hook utilitaire : renvoie [bursts, fireBurst] où fireBurst() ajoute
 * une nouvelle vague de 7 cœurs au state. Auto-nettoyage après 1.4s.
 */
export function useHeartBurst(): readonly [number[], () => void] {
  const [bursts, setBursts] = useState<number[]>([]);

  // Nettoie les bursts anciens (>1.4s) pour ne pas garder de bagage.
  useEffect(() => {
    if (bursts.length === 0) return;
    const t = window.setTimeout(() => {
      setBursts([]);
    }, 1400);
    return () => window.clearTimeout(t);
  }, [bursts]);

  function fire() {
    const baseId = Date.now();
    const ids = Array.from({ length: 7 }, (_, i) => baseId + i);
    setBursts((prev) => [...prev, ...ids]);
  }

  return [bursts, fire] as const;
}
