import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type {
  AppNotification,
  NotificationPayload,
  NotificationType,
} from '@/data/notifications';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): AppNotification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    payload: (row.payload ?? {}) as NotificationPayload,
    isRead: !!row.is_read,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export async function getMyNotifications(
  userId: string,
  limit = 50,
): Promise<AppNotification[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[notifications] getMyNotifications', error);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRow);
}

export async function getMyUnreadCount(userId: string): Promise<number> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (supabase as any)
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Crée une notification pour un user. Helper utilisé par les autres routes
 * (ex. réponse Karine à une idée, publication d'un nouveau post).
 */
export async function createNotification(args: {
  userId: string;
  type: NotificationType;
  payload: NotificationPayload;
}): Promise<{ ok: boolean }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('notifications').insert({
    user_id: args.userId,
    type: args.type,
    payload: args.payload,
  });
  if (error) {
    console.warn('[notifications] create', error);
    return { ok: false };
  }
  return { ok: true };
}
