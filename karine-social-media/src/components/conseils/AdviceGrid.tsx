'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Lock, Sparkles } from 'lucide-react';
import type { Advice } from '@/data/advice';
import { AdviceDetailModal } from './AdviceDetailModal';
import { PolaroidActionsAdvice } from './PolaroidActionsAdvice';

/** Rotation déterministe par slug pour éviter le mismatch SSR/CSR. */
function rotationFor(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 13) - 6);
}
function translateYFor(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 17 + slug.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 17) - 8);
}

export function AdviceGrid({
  items,
  isAuthenticated = false,
  favoritedSlugs = new Set<string>(),
  userHasPlan = false,
}: {
  items: Advice[];
  isAuthenticated?: boolean;
  favoritedSlugs?: Set<string>;
  /** Si false, conseils non is_public sont voilés + cadenas. */
  userHasPlan?: boolean;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [printSlug, setPrintSlug] = useState<string | null>(null);
  const active = activeSlug ? items.find((t) => t.id === activeSlug) ?? null : null;
  const printAdvice = printSlug ? items.find((t) => t.id === printSlug) ?? null : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!printAdvice) return;
    const onAfter = () => setPrintSlug(null);
    window.addEventListener('afterprint', onAfter);
    const t = setTimeout(() => window.print(), 100);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', onAfter);
    };
  }, [printAdvice]);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md rounded-2xl bg-white/85 px-6 py-10 text-center shadow-sm">
        <p className="text-sm font-semibold text-ink">Bientôt disponible</p>
        <p className="mt-1 text-xs text-ink-soft">
          Karine prépare ses conseils diététiques pour vous accompagner au quotidien.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="advice-grid-wrap overflow-x-clip">
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 px-1 pt-3 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-9 sm:px-2 sm:pt-4 lg:grid-cols-4 lg:gap-x-8 lg:gap-y-12">
          {items.map((t) => {
            const rot = rotationFor(t.id);
            const ty = translateYFor(t.id);
            const isAccessible = userHasPlan || t.isPublic;
            const showFreeBadge = !userHasPlan && t.isPublic;
            const showLock = !isAccessible;
            return (
              <li
                key={t.id}
                className="polaroid-advice"
                style={
                  {
                    '--rot': `${rot}deg`,
                    '--ty': `${ty}px`,
                  } as React.CSSProperties
                }
              >
                <div className="rounded-sm bg-white pb-2 pt-1.5 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.25)] ring-1 ring-black/5 transition focus-within:ring-2 focus-within:ring-sage sm:pb-3 sm:pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isAccessible) setActiveSlug(t.id);
                      else router.push(`/mon-plan?next=/conseils`);
                    }}
                    aria-label={
                      isAccessible
                        ? `Ouvrir le conseil : ${t.label}`
                        : `Conseil réservé aux abonnées — voir les plans`
                    }
                    className="block w-full cursor-pointer focus:outline-none"
                  >
                    <div className="relative px-1.5 sm:px-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={t.slides[0] ?? ''}
                        alt={t.label}
                        loading="lazy"
                        className={`aspect-square w-full rounded-[0.125rem] object-cover transition ${
                          showLock ? 'opacity-50 blur-sm saturate-50' : ''
                        }`}
                      />
                      {t.slides.length > 1 && (
                        <span className="absolute right-2 top-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[0.55rem] font-bold text-white sm:right-3 sm:top-1 sm:text-[0.6rem]">
                          +{t.slides.length - 1}
                        </span>
                      )}
                      {showFreeBadge && (
                        <span className="pointer-events-none absolute left-1 top-1 flex items-center gap-0.5 rounded-full bg-sage px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-white shadow-sm sm:px-2 sm:text-[0.6rem]">
                          <Sparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
                          Aperçu
                        </span>
                      )}
                      {showLock && (
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-1.5 sm:px-2">
                          <span className="grid h-10 w-10 place-items-center rounded-full bg-white/95 text-coral-dark shadow-md">
                            <Lock className="h-4 w-4" strokeWidth={2.4} />
                          </span>
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-2 px-1.5 text-center text-sm font-semibold leading-tight text-ink sm:mt-2.5 sm:px-2 sm:text-base lg:text-lg">
                      {t.label}
                    </p>
                  </button>
                  <PolaroidActionsAdvice
                    slug={t.id}
                    label={t.label}
                    initialLikes={t.likesCount}
                    onPrint={() => setPrintSlug(t.id)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <style>{`
        .polaroid-advice {
          transform: rotate(var(--rot)) translateY(var(--ty));
          transition: transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
          will-change: transform;
        }
        @media (max-width: 639px) {
          .polaroid-advice {
            transform:
              rotate(calc(var(--rot) * 0.5))
              translateY(calc(var(--ty) * 0.7))
              scale(0.9);
          }
        }
        .polaroid-advice:hover {
          transform: rotate(0deg) translateY(0) scale(1.05);
        }
        @media (prefers-reduced-motion: reduce) {
          .polaroid-advice { transition: none; }
        }
      `}</style>

      {/* Impression : 1 slide / page */}
      {mounted && printAdvice
        ? createPortal(
            <div className="advice-print-wrap" aria-hidden>
              {printAdvice.slides.map((src, i) => (
                <div
                  key={src}
                  className={`advice-print-page ${i === printAdvice.slides.length - 1 ? 'advice-print-page-last' : ''}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`${printAdvice.label} — ${i + 1}/${printAdvice.slides.length}`} />
                </div>
              ))}
              <style>{`
                .advice-print-wrap { display: none; }
                @media print {
                  @page { margin: 0.5cm; size: auto; }
                  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
                  .advice-print-wrap { display: block !important; }
                  .advice-print-page {
                    width: 100vw;
                    height: 100vh;
                    margin: 0;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    page-break-after: always;
                    break-after: page;
                    overflow: hidden;
                  }
                  .advice-print-page-last {
                    page-break-after: auto;
                    break-after: auto;
                  }
                  .advice-print-page img {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    display: block;
                  }
                }
              `}</style>
            </div>,
            document.body,
          )
        : null}

      <AdviceDetailModal
        advice={active}
        onClose={() => setActiveSlug(null)}
        isAuthenticated={isAuthenticated}
        favoritedSlugs={favoritedSlugs}
      />
    </>
  );
}
