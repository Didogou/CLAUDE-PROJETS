import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';
import { invalidatePortionCache } from '@/lib/portion-rules';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const supabase = createServiceClient();
  const { data, error } = await (supabase as any)
    .from('portion_modifiers')
    .select('id, keyword, multiplier, updated_at')
    .order('multiplier', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ modifiers: data ?? [] });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const keyword =
    typeof body?.keyword === 'string' ? body.keyword.trim().toLowerCase() : '';
  const multiplier =
    typeof body?.multiplier === 'number' && Number.isFinite(body.multiplier)
      ? Math.round(body.multiplier * 100) / 100
      : null;
  if (!keyword || multiplier === null || multiplier <= 0 || multiplier > 10) {
    return NextResponse.json(
      { error: 'keyword et multiplier (0..10) requis' },
      { status: 400 },
    );
  }
  const supabase = createServiceClient();
  const { data, error } = await (supabase as any)
    .from('portion_modifiers')
    .insert({ keyword, multiplier })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  invalidatePortionCache();
  return NextResponse.json({ modifier: data });
}
