/**
 * Anti open redirect : valide qu'une URL de redirection est interne.
 *
 * Accepte UNIQUEMENT les paths locaux ("/recettes", "/menus/abc").
 * Rejette :
 *   - URLs absolues ("https://evil.com")
 *   - Protocol-relative ("//evil.com")
 *   - Backslash injection ("/\evil.com")
 *   - User-info injection ("/@evil.com")
 *   - Path "/" seul = OK (page d'accueil)
 *
 * Usage :
 *   const next = safeNextPath(searchParams.get('next'), '/')
 *   redirect(next)
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = '/'): string {
  if (!raw || typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  // Doit commencer par "/" et ne PAS être suivi de "/" ou "\" ou "@"
  // (vecteurs courants d'open redirect).
  if (
    trimmed[0] !== '/' ||
    trimmed[1] === '/' ||
    trimmed[1] === '\\' ||
    trimmed[1] === '@'
  ) {
    return fallback;
  }
  // Nettoie aussi les caractères de contrôle (CR/LF qui pourraient
  // permettre du header injection si concaténés ailleurs).
  if (/[\r\n\t]/.test(trimmed)) return fallback;
  // Limite de longueur (anti-DoS).
  if (trimmed.length > 500) return fallback;
  return trimmed;
}
