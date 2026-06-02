'use client';

import { useEffect, useState } from 'react';
import { Heart, Leaf, Sparkles } from 'lucide-react';

type Particle = {
  kind: 'leaf' | 'heart' | 'sparkle';
  dx: number;
  dy: number;
  rot: number;
  size: number;
  delay: number;
  color: string;
};

// Palette verte/coral pour les conseils santé (vs jaune/sparkle pour astuces).
const COLORS = ['#86a36b', '#a6c08a', '#e2788d', '#f6c9d3', '#c3d9aa'];

/**
 * Burst de feuilles + cœurs + sparkles au mount, depuis le centre haut.
 * Variante "Conseils santé" du TipsFireworkBurst.
 */
export function AdviceFireworkBurst({ count = 18 }: { count?: number }) {
  const [alive, setAlive] = useState(true);
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const items: Particle[] = Array.from({ length: count }).map((_, i) => {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const distance = 150 + Math.random() * 120;
      const r = Math.random();
      const kind: Particle['kind'] = r < 0.5 ? 'leaf' : r < 0.8 ? 'sparkle' : 'heart';
      return {
        kind,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        rot: (Math.random() - 0.5) * 720,
        size: kind === 'leaf' ? 2.2 + Math.random() * 1.4 : 1.6 + Math.random() * 1.2,
        delay: Math.random() * 200,
        color: COLORS[i % COLORS.length],
      };
    });
    setParticles(items);
    const t = setTimeout(() => setAlive(false), 2200);
    return () => clearTimeout(t);
  }, [count]);

  if (!alive || particles.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-visible" aria-hidden>
      {particles.map((p, i) => {
        const Icon = p.kind === 'leaf' ? Leaf : p.kind === 'sparkle' ? Sparkles : Heart;
        return (
          <span
            key={i}
            className="firework-particle absolute left-1/2 top-32 grid place-items-center"
            style={
              {
                width: `${p.size}rem`,
                height: `${p.size}rem`,
                color: p.color,
                '--dx': `${p.dx}px`,
                '--dy': `${p.dy}px`,
                '--rot': `${p.rot}deg`,
                animationDelay: `${p.delay}ms`,
              } as React.CSSProperties
            }
          >
            <Icon
              className="h-full w-full"
              strokeWidth={2.2}
              fill={p.kind === 'heart' ? p.color : 'none'}
            />
          </span>
        );
      })}
      <style>{`
        @keyframes firework-burst {
          0%   { transform: translate(-50%, -50%) scale(0) rotate(0deg); opacity: 0; }
          15%  { opacity: 1; }
          60%  { opacity: 1; }
          100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1) rotate(var(--rot)); opacity: 0; }
        }
        .firework-particle {
          animation: firework-burst 2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          will-change: transform, opacity;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.18));
        }
        @media (prefers-reduced-motion: reduce) {
          .firework-particle { animation: none; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
