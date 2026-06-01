import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type {
  Idea,
  IdeaStatus,
  IdeaType,
  IdeaWithAuthor,
} from '@/data/ideas';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Idea {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as IdeaType,
    title: row.title,
    body: row.body,
    status: row.status as IdeaStatus,
    reply: row.reply,
    repliedAt: row.replied_at,
    repliedBy: row.replied_by,
    createdAt: row.created_at,
  };
}

export async function createIdea(args: {
  userId: string;
  type: IdeaType;
  title: string;
  body: string;
}): Promise<{ ok: true; idea: Idea } | { ok: false; reason: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('ideas')
    .insert({
      user_id: args.userId,
      type: args.type,
      title: args.title,
      body: args.body,
    })
    .select('*')
    .single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, idea: mapRow(data) };
}

export async function getIdeasForAdmin(
  status?: IdeaStatus,
): Promise<IdeaWithAuthor[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('ideas')
    .select('*, profiles:user_id(email, full_name)')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) {
    console.warn('[ideas] getIdeasForAdmin', error);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    ...mapRow(r),
    authorEmail: r.profiles?.email ?? null,
    authorName: r.profiles?.full_name ?? null,
  }));
}

export async function getIdea(
  id: number,
): Promise<IdeaWithAuthor | null> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('ideas')
    .select('*, profiles:user_id(email, full_name)')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...mapRow(data),
    authorEmail: data.profiles?.email ?? null,
    authorName: data.profiles?.full_name ?? null,
  };
}

export async function replyToIdea(args: {
  ideaId: number;
  adminId: string;
  reply: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('ideas')
    .update({
      reply: args.reply,
      replied_at: new Date().toISOString(),
      replied_by: args.adminId,
      status: 'replied',
    })
    .eq('id', args.ideaId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
