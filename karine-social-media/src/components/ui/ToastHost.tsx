'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertCircle, Info } from 'lucide-react';
import { TOAST_EVENT, type ToastDetail, type ToastKind } from '@/lib/toast';

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

  useEffect(() => setMounted(true), []);

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

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2 px-3 print:hidden"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} kind={t.kind} message={t.message} />
      ))}
    </div>,
    document.body,
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
