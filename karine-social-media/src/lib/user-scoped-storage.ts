/**
 * Helpers pour préfixer les clés localStorage avec l'user ID courant.
 *
 * Pourquoi (audit agent B 2026-06-12) : les clés brutes (`karine.liked-recipes.v1`,
 * `karine-shopping-{menuId}`, etc.) sont partagées entre tous les comptes
 * qui ouvrent la session sur le même appareil. Cas typique : tablette
 * de cuisine partagée mari/femme → ils voient mêmes likes et courses.
 *
 * Stratégie progressive :
 *  1. Au login, `setCurrentUserScope(userId)` stocke un cookie lisible
 *     côté client (`karine-uid`).
 *  2. Au logout, `clearCurrentUserScope()` purge le cookie.
 *  3. Les helpers `getScopedItem` / `setScopedItem` préfixent
 *     automatiquement la clé par l'user ID.
 *  4. Anonyme (pas de cookie) → fallback sur la clé non préfixée
 *     (compat appareil unique sans compte).
 *
 * Backward-compat : si la clé scopée n'existe pas, on lit la clé legacy
 * (sans préfixe) pour ne pas perdre les likes existants.
 */

const COOKIE_NAME = 'karine-uid';

/** Lit l'user ID courant depuis le cookie. Renvoie '' si anonyme. */
export function getCurrentUserScope(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return m ? decodeURIComponent(m.split('=')[1] ?? '') : '';
}

/** Stocke l'user ID dans un cookie 30 jours (SameSite=Lax). */
export function setCurrentUserScope(userId: string): void {
  if (typeof document === 'undefined') return;
  const safe = encodeURIComponent(userId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64));
  if (!safe) return;
  const maxAge = 60 * 60 * 24 * 30; // 30 jours
  document.cookie = `${COOKIE_NAME}=${safe}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function clearCurrentUserScope(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
}

/** Préfixe une clé avec l'user ID courant (ou la laisse brute si anonyme). */
export function scopedKey(baseKey: string): string {
  const uid = getCurrentUserScope();
  return uid ? `u:${uid}:${baseKey}` : baseKey;
}

/**
 * Lit un item scopé. Fallback sur la clé legacy (sans préfixe) si la
 * clé scopée n'existe pas — permet une migration douce des données
 * existantes.
 */
export function getScopedItem(baseKey: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  const uid = getCurrentUserScope();
  if (uid) {
    const v = localStorage.getItem(`u:${uid}:${baseKey}`);
    if (v !== null) return v;
    // Migration douce : si la clé scopée n'existe pas mais la legacy oui,
    // on copie + retire la legacy (one-time per user).
    const legacy = localStorage.getItem(baseKey);
    if (legacy !== null) {
      localStorage.setItem(`u:${uid}:${baseKey}`, legacy);
      // ⚠️ On NE supprime PAS la clé legacy : un autre user sur le même
      // device pourrait y avoir migré ses données aussi. La perte mémoire
      // est négligeable (quelques arrays de strings).
      return legacy;
    }
    return null;
  }
  return localStorage.getItem(baseKey);
}

export function setScopedItem(baseKey: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(scopedKey(baseKey), value);
}

export function removeScopedItem(baseKey: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(scopedKey(baseKey));
}
