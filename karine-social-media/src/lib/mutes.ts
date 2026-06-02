import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

export type UserMute = {
  userId: string;
  mutedBy: string | null;
  reason: string | null;
  until: string | null; // null = permanent
  createdAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): UserMute {
  return {
    userId: row.user_id,
    mutedBy: row.muted_by,
    reason: row.reason,
    until: row.until,
    createdAt: row.created_at,
  };
}

/**
 * Une utilisatrice est mute si sa ligne existe ET (until null OU until > now).
 * À utiliser AVANT toute action sociale (like / comment / idée).
 */
export async function isUserMuted(userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('user_mutes')
    .select('until')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return false;
  const until = data.until as string | null;
  if (!until) return true; // mute permanent
  return new Date(until) > new Date();
}

export async function getUserMute(userId: string): Promise<UserMute | null> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('user_mutes')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data);
}

export async function getAllMutes(): Promise<UserMute[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('user_mutes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRow);
}

export async function setUserMute(args: {
  userId: string;
  mutedBy: string;
  reason: string | null;
  until: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('user_mutes')
    .upsert({
      user_id: args.userId,
      muted_by: args.mutedBy,
      reason: args.reason,
      until: args.until,
    }, { onConflict: 'user_id' });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function unmuteUser(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('user_mutes')
    .delete()
    .eq('user_id', userId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
