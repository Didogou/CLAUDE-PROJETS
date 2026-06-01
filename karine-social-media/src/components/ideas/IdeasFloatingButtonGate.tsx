'use client';

import { usePathname } from 'next/navigation';
import { IdeasFloatingButton } from './IdeasFloatingButton';

/**
 * Gate client : décide si on affiche le bouton "Idées" flottant sur la page
 * courante. La décision auth est faite côté server par le parent (passé via
 * `isAuthenticated`), le path-check est fait ici via usePathname().
 *
 *   - User authentifié uniquement (visiteurs n'ont pas accès)
 *   - PAS sur les routes admin (Karine ne soumet pas à elle-même)
 *   - PAS sur les routes auth (login, signup, reset, etc.)
 */
export function IdeasFloatingButtonGate({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const path = usePathname() ?? '';

  if (!isAuthenticated) return null;

  if (
    path.startsWith('/admin') ||
    path.startsWith('/login') ||
    path.startsWith('/signup') ||
    path.startsWith('/auth') ||
    path.startsWith('/mot-de-passe-oublie') ||
    path.startsWith('/nouveau-mot-de-passe')
  ) {
    return null;
  }

  return <IdeasFloatingButton />;
}
