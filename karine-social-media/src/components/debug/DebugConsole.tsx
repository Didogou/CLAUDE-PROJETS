'use client';

import { useEffect } from 'react';

/**
 * Charge eruda — une console virtuelle DevTools intégrée dans la page,
 * utile pour debug sur iPhone (où l'on n'a pas Chrome DevTools / F12).
 *
 * Activation :
 *   - localhost : toujours actif
 *   - production : seulement si URL contient ?debug=1 (et reste actif via sessionStorage
 *     une fois activé, pour survivre aux navigations).
 *
 * Une fois actif, un bouton flottant apparaît en bas à droite. Tap → console mobile.
 */
export function DebugConsole() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isLocal = /localhost|127\.0\.0\.1|192\.168\./.test(window.location.hostname);
    // SECURITE : eruda est activable UNIQUEMENT en local. En prod, le
    // parametre ?debug=1 et le sessionStorage sont ignores — risque
    // sinon : self-XSS / leak JWT Supabase via capture d'ecran si la
    // patiente est piegee a coller du code dans la console.
    if (!isLocal) return;

    let cancelled = false;
    (async () => {
      try {
        // Import dynamique : eruda n'est pas dans le bundle initial
        const eruda = (await import('eruda')).default;
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!(window as any).__erudaInit) {
          eruda.init();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__erudaInit = true;
        }
      } catch (e) {
        console.warn('[eruda] échec init', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
