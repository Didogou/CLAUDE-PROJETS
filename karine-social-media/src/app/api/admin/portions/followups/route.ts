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
    .from('portion_followups')
    .select(
      'id, trigger_keyword, question, suggested_food, default_g, exclude_keywords, updated_at',
    )
    .order('trigger_keyword', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ followups: data ?? [] });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const trigger =
    typeof body?.triggerKeyword === 'string'
      ? body.triggerKeyword.trim().toLowerCase()
      : '';
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  const suggestedFood =
    typeof body?.suggestedFood === 'string'
      ? body.suggestedFood.trim().toLowerCase()
      : '';
  const defaultG =
    typeof body?.defaultG === 'number' && Number.isFinite(body.defaultG)
      ? Math.round(body.defaultG)
      : null;
  const excludeKeywords: string[] = Array.isArray(body?.excludeKeywords)
    ? body.excludeKeywords
        .filter((k: unknown): k is string => typeof k === 'string')
        .map((k: string) => k.trim().toLowerCase())
        .filter(Boolean)
    : [];

  if (!trigger || !question || !suggestedFood || defaultG === null) {
    return NextResponse.json(
      { error: 'triggerKeyword, question, suggestedFood, defaultG requis' },
      { status: 400 },
    );
  }
  if (defaultG <= 0 || defaultG > 1000) {
    return NextResponse.json(
      { error: 'defaultG hors bornes (1..1000)' },
      { status: 400 },
    );
  }
  const supabase = createServiceClient();
  const { data, error } = await (supabase as any)
    .from('portion_followups')
    .insert({
      trigger_keyword: trigger,
      question,
      suggested_food: suggestedFood,
      default_g: defaultG,
      exclude_keywords: excludeKeywords,
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  invalidatePortionCache();
  return NextResponse.json({ followup: data });
}
