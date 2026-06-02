/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState } from 'react';
import type { RecipeCategory } from '@/data/recipes';

// V1 : on a pour l'instant 4 PNG (courgette, oignons, poivron, coeur) +
// `tomate` à venir. En attendant les images dédiées (fruits + chocolat pour
// desserts, salades pour entrées), on utilise le même pool partout.
const COMMON = [
  '/images/effects/courgette.webp',
  '/images/effects/oignons.webp',
  '/images/effects/poivron.webp',
  '/images/effects/coeur.webp',
];

const PARTICLES: Record<RecipeCategory, string[]> = {
  petit_dejeuner: COMMON,
  entree: COMMON,
  salade: COMMON,
  plat: COMMON,
  sauce: COMMON,
  gouter: COMMON,
  dessert: COMMON,
  boisson: COMMON,
  aperitif: COMMON,
  repas_fete: COMMON,
};

type Particle = {
  src: string;
  dx: number;
  dy: number;
  rot: number;
  size: number; // en rem
  delay: number;
};

/**
 * Burst au mount : explosion en éventail depuis le centre,
 * rotation + scale 0→1, fade-out en fin. Une seule fois, ~1.6s total.
 */
export function FireworkBurst({
  category,
  count = 12,
}: {
  category: RecipeCategory;
  count?: number;
}) {
  const [alive, setAlive] = useState(true);
  // Particules générées côté client uniquement (Math.random produirait sinon
  // un mismatch d'hydratation entre le rendu SSR et le client).
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const pool = PARTICLES[category];
    const items: Particle[] = Array.from({ length: count }).map((_, i) => {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const distance = 130 + Math.random() * 90;
      return {
        src: pool[i % pool.length],
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        rot: (Math.random() - 0.5) * 720,
        size: 2.2 + Math.random() * 1.4,
        delay: Math.random() * 200,
      };
    });
    setParticles(items);
    const t = setTimeout(() => setAlive(false), 2000);
    return () => clearTimeout(t);
  }, [category, count]);

  if (!alive || particles.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-visible" aria-hidden>
      {particles.map((p, i) => (
        <img
          key={i}
          src={p.src}
          alt=""
          draggable={false}
          className="firework-particle absolute left-1/2 top-1/2 h-auto select-none"
          style={
            {
              width: `${p.size}rem`,
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
              animationDelay: `${p.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
      <style>{`
        @keyframes firework-burst {
          0%   { transform: translate(-50%, -50%) scale(0) rotate(0deg); opacity: 0; }
          15%  { opacity: 1; }
          60%  { opacity: 1; }
          100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1) rotate(var(--rot)); opacity: 0; }
        }
        .firework-particle {
          animation: firework-burst 1.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .firework-particle { animation: none; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
