import { getCurrentUser } from './current-user';

/**
 * Renvoie true si l'utilisatrice connectée a un plan actif (patiente,
 * abonnée ou admin) qui lui donne accès complet aux contenus payants
 * (recettes non publiques, menus, etc.).
 *
 * Centralise la règle pour ne pas avoir à réécrire le test
 * `effectiveRole === 'patient' || 'subscriber' || 'admin'` dans chaque
 * page server. Default sécurisé : false (pas d'accès) si pas
 * authentifié ou rôle inconnu.
 */
export async function userHasPlanAccess(): Promise<boolean> {
  const user = await getCurrentUser();
  return (
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin'
  );
}
