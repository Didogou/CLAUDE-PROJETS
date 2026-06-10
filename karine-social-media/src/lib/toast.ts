/**
 * Toast tres simple via CustomEvent + ToastHost monte dans le
 * RootLayout. Pas de provider context, pas de zustand : un seul
 * event "app-toast" avec detail = { message, kind }.
 */

export type ToastKind = 'info' | 'success' | 'error' | 'banner-pink';

export type ToastDetail = {
  message: string;
  kind: ToastKind;
  /** Duree en ms avant disparition. Default 3500. */
  durationMs?: number;
};

export const TOAST_EVENT = 'app-toast';
/** Cle sessionStorage pour persister un toast entre 2 navigations
 *  (ex. validation depuis sub-page → redirect home → toast affiche
 *  sur la home). Le ToastHost lit ce flag au mount et le clear. */
export const TOAST_PENDING_KEY = 'karine.toast.pending';

export function showToast(message: string, kind: ToastKind = 'success', durationMs?: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, {
      detail: { message, kind, durationMs },
    }),
  );
}

/** Met un toast en attente : sera affiche au prochain mount d'un
 *  composant qui appelle `consumePendingToast()`. Utile pour
 *  notifier APRES une navigation router.push(). */
export function queueToastForNextPage(detail: ToastDetail) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(TOAST_PENDING_KEY, JSON.stringify(detail));
  } catch {
    /* sessionStorage indispo (private mode) → silent */
  }
}
