// Types et constantes partagés client/serveur (pas de server-only imports ici).

export const ALL_ROLES = ['visitor', 'patient', 'subscriber', 'admin'] as const;
export type AppRole = (typeof ALL_ROLES)[number];

export type PagePermission = {
  path: string;
  allowedRoles: AppRole[];
  description: string | null;
  updatedAt: string;
};
