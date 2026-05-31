import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';

const BUCKET = 'content-images';

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug } = await ctx.params;
    const form = await request.formData();

    const label = String(form.get('label') || '').trim();
    const status = String(form.get('status') || 'draft');
    const tags = splitList(form.get('tags') as string | null);

    if (!label) return NextResponse.json({ error: 'Label requis' }, { status: 400 });
    if (!['draft', 'published'].includes(status))
      return NextResponse.json({ error: 'Status invalide' }, { status: 400 });

    // Liste des slides restantes envoyée par le client (après suppression(s))
    const existingSlides = JSON.parse(
      String(form.get('existingSlides') || '[]'),
    ) as string[];

    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current } = await (supabase as any)
      .from('tips')
      .select('status, published_at, slides')
      .eq('slug', slug)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: 'Astuce introuvable' }, { status: 404 });

    type TipUpdate = {
      label: string;
      tags: string[];
      status: string;
      slides: string[];
      published_at?: string | null;
    };

    const update: TipUpdate = { label, tags, status, slides: existingSlides };
    if (status === 'published' && current.status !== 'published') {
      update.published_at = new Date().toISOString();
    } else if (status !== 'published' && current.status === 'published') {
      update.published_at = null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('tips').update(update).eq('slug', slug);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { slug } = await ctx.params;
    const supabase = createServiceClient();

    const { data: files } = await supabase.storage.from(BUCKET).list(`tips/${slug}`);
    if (files && files.length > 0) {
      const paths = files.map((f) => `tips/${slug}/${f.name}`);
      await supabase.storage.from(BUCKET).remove(paths);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('tips').delete().eq('slug', slug);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
