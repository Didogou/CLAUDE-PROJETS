import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { ActivePatient, PatientRequest } from '@/data/patients';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRequest(row: any): PatientRequest {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.profile?.email ?? '',
    fullName: row.profile?.full_name ?? null,
    message: row.message ?? '',
    status: row.status,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    reminderCount: row.reminder_count ?? 0,
    lastReminderAt: row.last_reminder_at ?? null,
    reviewerComment: row.reviewer_comment ?? null,
  };
}

/**
 * Récupère la demande patiente la plus récente d'un utilisateur connecté.
 * Utilisé sur /profil pour afficher l'état (pending / rejected) + relancer.
 */
export async function getMyLatestPatientRequest(
  userId: string,
): Promise<PatientRequest | null> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('patient_requests')
    .select(
      '*, profile:profiles!patient_requests_user_id_fkey(email, full_name)',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRequest(data) : null;
}

/** Cooldown en jours entre 2 actions (création + relance, ou 2 relances).
 *  Configurable via env var pour mettre 0 en test, 3 en prod. */
export function getRelanceCooldownDays(): number {
  const raw = process.env.PATIENT_RELANCE_COOLDOWN_DAYS;
  const n = raw ? parseInt(raw, 10) : 3;
  if (Number.isNaN(n) || n < 0) return 3;
  return n;
}

async function getRequestsByStatus(
  status: 'pending' | 'approved' | 'rejected',
): Promise<PatientRequest[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('patient_requests')
    .select(
      '*, profile:profiles!patient_requests_user_id_fkey(email, full_name)',
    )
    .eq('status', status)
    .order(status === 'pending' ? 'created_at' : 'reviewed_at', {
      ascending: status === 'pending',
    });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRequest);
}

export async function getPendingPatientRequests(): Promise<PatientRequest[]> {
  return getRequestsByStatus('pending');
}

export async function getRejectedPatientRequests(): Promise<PatientRequest[]> {
  return getRequestsByStatus('rejected');
}

export async function getAllPatientRequests(): Promise<PatientRequest[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('patient_requests')
    .select('*, profile:profiles!patient_requests_user_id_fkey(email, full_name)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRequest);
}

export async function getActivePatients(): Promise<ActivePatient[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('profiles')
    .select('id, email, full_name, patient_access_expires_at')
    .eq('role', 'patient')
    .order('patient_access_expires_at', { ascending: true });
  if (error) throw error;
  const now = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((row) => {
    const exp = row.patient_access_expires_at as string | null;
    const daysRemaining = exp
      ? Math.ceil((new Date(exp).getTime() - now) / (1000 * 60 * 60 * 24))
      : null;
    return {
      userId: row.id,
      email: row.email,
      fullName: row.full_name,
      expiresAt: exp,
      daysRemaining,
    };
  });
}

/**
 * Email à utiliser pour notifier Karine d'une relance / nouvelle demande.
 * Lue depuis env var EMAIL_TO_ADMIN, fallback : 'karine@karine-dietetique.fr'.
 */
export function getAdminEmail(): string {
  return process.env.EMAIL_TO_ADMIN ?? 'karine@karine-dietetique.fr';
}
