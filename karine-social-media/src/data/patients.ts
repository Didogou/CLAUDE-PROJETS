// Types partagés client/serveur (pas de server-only imports ici).

export type PatientRequestStatus = 'pending' | 'approved' | 'rejected';

export type PatientRequest = {
  id: number;
  userId: string;
  email: string;
  fullName: string | null;
  message: string;
  status: PatientRequestStatus;
  reviewedAt: string | null;
  createdAt: string;
  /** Nombre de fois où la patiente a relancé sa demande (V1 incrément quand
   * elle re-clique « Je suis patiente » alors qu'une demande pending existe). */
  reminderCount: number;
  /** Commentaire libre de Karine quand elle valide ou refuse (affiché à la
   * patiente dans l'email de notification). */
  reviewerComment: string | null;
};

export type ActivePatient = {
  userId: string;
  email: string;
  fullName: string | null;
  expiresAt: string | null;
  daysRemaining: number | null; // négatif si expiré
};
