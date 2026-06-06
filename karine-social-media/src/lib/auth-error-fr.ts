/**
 * Traduit en français les messages d'erreur les plus fréquents de Supabase
 * Auth (login / signup / reset password / magic link).
 *
 * Les messages d'origine sont en anglais et peuvent évoluer avec les
 * versions de la lib Supabase ; on matche sur des fragments suffisamment
 * stables (pas l'égalité stricte). Fallback : on renvoie le message
 * d'origine tel quel — mieux qu'une chaîne générique muette.
 *
 * Pour des raisons de sécurité, on volontairement NE distingue PAS
 * "user not found" de "wrong password" → même message côté UI, sinon on
 * révèle l'existence d'un compte à un attaquant.
 */
export function authErrorFr(raw: string): string {
  const m = raw.toLowerCase();

  // Login : mauvais identifiants OU compte inexistant (volontairement fusionnés)
  if (
    m.includes('invalid login credentials') ||
    m.includes('invalid credentials') ||
    m.includes('user not found') ||
    m.includes('email not found')
  ) {
    return 'E-mail ou mot de passe incorrect.';
  }

  // Compte créé mais pas encore confirmé par e-mail
  if (m.includes('email not confirmed') || m.includes('not confirmed')) {
    return 'Tu dois confirmer ton e-mail avant de te connecter. Vérifie ta boîte de réception.';
  }

  // Signup : adresse déjà utilisée
  if (
    m.includes('already registered') ||
    m.includes('already exists') ||
    m.includes('user already registered')
  ) {
    return 'Un compte existe déjà avec cet e-mail. Connecte-toi ou utilise « Mot de passe oublié ? ».';
  }

  // Mot de passe trop faible (à la création / au changement)
  if (m.includes('password') && (m.includes('weak') || m.includes('at least'))) {
    return 'Le mot de passe est trop simple. Utilise au moins 8 caractères, avec une majuscule et un chiffre.';
  }

  // Rate limiting (trop d'essais / trop de mails)
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Trop de tentatives. Réessaie dans quelques minutes.';
  }

  // E-mail mal formé
  if (m.includes('invalid email') || m.includes('email address')) {
    return "L'adresse e-mail n'est pas valide.";
  }

  // Lien magique / OTP expiré ou invalide
  if (m.includes('expired') || m.includes('invalid token') || m.includes('otp')) {
    return 'Ce lien a expiré ou est invalide. Demande-en un nouveau.';
  }

  // Réseau / serveur
  if (
    m.includes('network') ||
    m.includes('fetch failed') ||
    m.includes('failed to fetch')
  ) {
    return 'Impossible de joindre le serveur. Vérifie ta connexion et réessaie.';
  }

  // Fallback : le message brut (plutôt que de muter en chaîne générique)
  return raw || 'Erreur inattendue. Réessaie dans un instant.';
}
