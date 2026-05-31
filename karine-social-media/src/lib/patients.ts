import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { ActivePatient, PatientRequest } from '@/data/patients';

// Cast à la volée car les types Supabase ne connaissent pas patient_requests
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
  };
}

export async function getPendingPatientRequests(): Promise<PatientRequest[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('patient_requests')
    .select('*, profile:profiles!patient_requests_user_id_fkey(email, full_name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRequest);
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
