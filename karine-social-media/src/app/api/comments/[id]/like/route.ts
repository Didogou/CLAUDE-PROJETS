import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// V1 anonyme : +1 sur likes_count (idem recettes).
export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const supabase = createServiceClient();

    const { data: current, error: readErr } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('comments' as any)
      .select('likes_count')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) return NextResponse.json({ error: 'Commentaire introuvable' }, { status: 404 });

    const prev = (current as { likes_count?: number | null }).likes_count ?? 0;
    const next = prev + 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase.from('comments' as any) as any)
      .update({ likes_count: next })
      .eq('id', id);
    if (upErr) throw upErr;

    return NextResponse.json({ likes: next });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
