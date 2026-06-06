/**
 * Persistance courte durée d'une demande d'accès patiente "en attente"
 * pour traverser un round-trip OAuth (Google / Facebook).
 *
 * Pourquoi pas localStorage : on veut une portée session navigateur,
 * pas une persistance multi-onglet/multi-session qui pourrait
 * re-déclencher une demande des semaines plus tard si l'utilisatrice
 * referme l'onglet en plein milieu.
 *
 * Anti-stale : on ignore les entrées vieilles de plus d'1 heure,
 * pour le cas où l'utilisatrice abandonne le flow OAuth puis revient
 * bien plus tard.
 *
 * Flow attendu :
 *   1. /signup : utilisatrice coche "patiente" puis clique Google →
 *      stashPendingPatientRequest(message) AVANT signInWithOAuth.
 *   2. Round-trip Google → /auth/callback → redirect home.
 *   3. PostAuthPatientRequestEffect (monté global) lit la demande,
 *      POST /api/patient-requests, toast confirmation.
 */

const KEY = 'karine.pendingPatientRequest';
const MAX_AGE_MS = 60 * 60 * 1000; // 1 heure

export function stashPendingPatientRequest(message: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ message: message.trim().slice(0, 1000), at: Date.now() }),
    );
  } catch {
    // sessionStorage peut être bloqué (Safari ITP, mode privé) — on
    // n'a pas de fallback, la demande sera juste perdue. On l'affiche
    // pas à l'utilisatrice : elle pourra refaire la demande depuis
    // son profil.
  }
}

/**
 * Consomme la demande en attente : retourne le message stashé et
 * efface la clé immédiatement (one-shot). Retourne `null` si rien
 * en attente OU si l'entrée est trop ancienne.
 */
export function popPendingPatientRequest(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    // Important : clear AVANT le parse pour ne pas boucler si parse rate
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as { message?: string; at?: number };
    if (!parsed || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    return typeof parsed.message === 'string' ? parsed.message : '';
  } catch {
    return null;
  }
}
