import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

export type ProfileForModeration = {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: string;
  muted: boolean;
  mutedUntil: string | null;
  muteReason: string | null;
};

export async function getProfilesForModeration(): Promise<ProfileForModeration[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profiles, error } = await (supabase as any)
    .from('profiles')
    .select('id, email, full_name, avatar_url, role')
    .neq('role', 'admin')
    .order('full_name', { ascending: true, nullsFirst: false });
  if (error) {
    console.warn('[profiles-admin] getAll', error);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mutes } = await (supabase as any)
    .from('user_mutes')
    .select('user_id, until, reason');
  const muteByUser = new Map<string, { until: string | null; reason: string | null }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of (mutes ?? []) as any[]) {
    muteByUser.set(m.user_id, { until: m.until, reason: m.reason });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((profiles ?? []) as any[]).map((p) => {
    const m = muteByUser.get(p.id);
    const muted =
      !!m && (m.until === null || new Date(m.until) > new Date());
    return {
      id: p.id,
      email: p.email,
      fullName: p.full_name,
      avatarUrl: p.avatar_url,
      role: p.role,
      muted,
      mutedUntil: m?.until ?? null,
      muteReason: m?.reason ?? null,
    };
  });
}
