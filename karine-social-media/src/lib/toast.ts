/**
 * Toast tres simple via CustomEvent + ToastHost monte dans le
 * RootLayout. Pas de provider context, pas de zustand : un seul
 * event "app-toast" avec detail = { message, kind }.
 */

export type ToastKind = 'info' | 'success' | 'error';

export type ToastDetail = {
  message: string;
  kind: ToastKind;
  /** Duree en ms avant disparition. Default 3500. */
  durationMs?: number;
};

export const TOAST_EVENT = 'app-toast';

export function showToast(message: string, kind: ToastKind = 'success', durationMs?: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, {
      detail: { message, kind, durationMs },
    }),
  );
}
