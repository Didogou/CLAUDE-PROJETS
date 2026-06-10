'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Check, AlertCircle, Info } from 'lucide-react';
import { TOAST_EVENT, TOAST_PENDING_KEY, type ToastDetail, type ToastKind } from '@/lib/toast';

type ActiveToast = ToastDetail & { id: number };

let uid = 0;

/**
 * Hote des toasts — monte 1 fois dans le RootLayout. Ecoute
 * l event "app-toast" et affiche les toasts en bas centre.
 *
 * Animation slide-up + fade. Max 3 toasts empiles. Auto-dismiss
 * apres detail.durationMs (default 3500ms).
 */
export function ToastHost() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const [mounted, setMounted] = useState(false);
  // Important : ToastHost est mount UNE seule fois dans le RootLayout.
  // Pour declencher la lecture du sessionStorage a CHAQUE navigation
  // (le user nav de la sub-page calories → home → on doit afficher
  // le toast pending sur la home), on depend du pathname.
  const pathname = usePathname();

  useEffect(() => setMounted(true), []);

  // Au mount ET a chaque changement de route : lit le toast "pending"
  // en sessionStorage (pose par une page precedente avant son
  // router.push) et le dispatch. C'est CE mecanisme qui permet
  // d'afficher un toast APRES une navigation router.push().
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TOAST_PENDING_KEY);
      if (!raw) return;
      sessionStorage.removeItem(TOAST_PENDING_KEY);
      const detail = JSON.parse(raw) as ToastDetail;
      if (!detail || !detail.message) return;
      // Petit delay pour que le composant cible soit mount aussi
      // (sinon le toast peut etre cache par les transitions Next).
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }),
        );
      }, 150);
    } catch {
      /* parse fail → silent */
    }
  }, [pathname]);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      if (!detail || !detail.message) return;
      const id = ++uid;
      const next: ActiveToast = {
        id,
        message: detail.message,
        kind: detail.kind,
        durationMs: detail.durationMs ?? 3500,
      };
      setToasts((prev) => [...prev.slice(-2), next]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, next.durationMs);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (!mounted || toasts.length === 0) return null;

  // Split en 2 categories : banner-pink rend en BANDEAU pleine largeur
  // EN HAUT (style notification iOS), les autres en pill centre bas.
  const bannerToasts = toasts.filter((t) => t.kind === 'banner-pink');
  const pillToasts = toasts.filter((t) => t.kind !== 'banner-pink');

  return (
    <>
      {bannerToasts.length > 0 &&
        createPortal(
          <div
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col gap-1 print:hidden"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            {bannerToasts.map((t) => (
              <BannerToast key={t.id} message={t.message} />
            ))}
          </div>,
          document.body,
        )}
      {pillToasts.length > 0 &&
        createPortal(
          <div
            aria-live="polite"
            className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2 px-3 print:hidden"
          >
            {pillToasts.map((t) => (
              <ToastItem key={t.id} kind={t.kind} message={t.message} />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function BannerToast({ message }: { message: string }) {
  return (
    <div
      className="pointer-events-auto flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold text-white shadow-md"
      style={{
        animation: 'banner-down 250ms cubic-bezier(0.16, 1, 0.3, 1)',
        background: 'linear-gradient(90deg, #E8704F 0%, #F08672 50%, #E8704F 100%)',
      }}
    >
      <Check className="size-5 shrink-0" strokeWidth={3} />
      <span>{message}</span>
      <style>{`
        @keyframes banner-down {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function ToastItem({ kind, message }: { kind: ToastKind; message: string }) {
  const palette =
    kind === 'success'
      ? 'bg-emerald-500 text-white'
      : kind === 'error'
        ? 'bg-rose-500 text-white'
        : 'bg-coral text-white';
  const Icon = kind === 'success' ? Check : kind === 'error' ? AlertCircle : Info;
  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-xl ${palette}`}
      style={{ animation: 'toast-up 200ms ease-out' }}
    >
      <Icon className="size-4 shrink-0" />
      <span>{message}</span>
      <style>{`
        @keyframes toast-up {
          from { transform: translateY(0.5rem); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
