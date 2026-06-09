/**
 * Anti-leak des erreurs verboses.
 *
 * Pattern interdit (avant audit) :
 *   catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '...' }) }
 *
 * Postgres / Stripe renvoient des messages qui leakent :
 *   - noms de tables / colonnes / contraintes
 *   - existence de comptes Stripe ("No such customer cus_...")
 *   - paths fichiers serveur
 *
 * Ce helper :
 *  1. console.error l'erreur complete cote serveur (pour debug Vercel logs)
 *  2. Retourne un message GENERIQUE cote client
 *  3. Si l'erreur est de classe ApiError ou que le caller passe un message
 *     metier explicite, on le retourne tel quel (les messages metier
 *     sont safe par definition).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Exception "metier" dont le message peut etre renvoye au client en
 * toute securite. Use case : "Email deja utilise", "Quantite invalide",
 * "Plan expire", etc.
 */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function safeError(
  err: unknown,
  /** Tag pour debug serveur (ex: "[admin/recipes POST]"). */
  tag: string,
  /** Message generique cote client. */
  publicMessage: string = 'Une erreur est survenue. Réessaie ou contacte le support.',
): { status: number; body: { error: string } } {
  // ApiError : message metier safe → on le renvoie.
  if (err instanceof ApiError) {
    return { status: err.status, body: { error: err.message } };
  }
  // Log complet cote serveur uniquement (visible dans Vercel logs).
  if (err instanceof Error) {
    console.error(tag, err.message, err.stack);
  } else {
    console.error(tag, err);
  }
  // Cote client : message generique. Aucune fuite Postgres/Stripe.
  return { status: 500, body: { error: publicMessage } };
}
