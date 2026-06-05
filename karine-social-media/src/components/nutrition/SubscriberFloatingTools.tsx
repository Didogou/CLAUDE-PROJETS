/**
 * Wrapper serveur — autrefois montait les FAB nutrition (calories +
 * eau). Refonte 2026-06-05 : tout est désormais accessible via la
 * pill "Mon suivi" du header (cf. TrackingPill / AppHeader). Plus
 * de bouton flottant. Composant gardé pour rétro-compat des layouts
 * qui l'importent, mais retourne null.
 */
export async function SubscriberFloatingTools() {
  return null;
}
