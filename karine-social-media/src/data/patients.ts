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
};

export type ActivePatient = {
  userId: string;
  email: string;
  fullName: string | null;
  expiresAt: string | null;
  daysRemaining: number | null; // négatif si expiré
};
