/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/ciqual-aliases
 *
 * Cree un alias MANUEL (source='admin_manual', status='resolved'
 * direct car Karine sait ce qu'elle fait).
 *
 * Body : { ciqual_id: number, alias_display: string }
 * Output : { id, ciqual_id, alias, alias_display, status, source }
 *
 * Le champ `alias` est calcule automatiquement (lowercase + strip
 * diacritics) pour le matching. Idempotent : si l'alias existe deja
 * pour ce ciqual_id, on le retourne tel quel (status update si etait
 * rejected → resolved).
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/\s+/g, ' ');
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    ciqual_id?: number;
    alias_display?: string;
  };

  const ciqualId = Number(body.ciqual_id);
  const aliasDisplay = (body.alias_display ?? '').trim();
  if (!Number.isFinite(ciqualId) || ciqualId <= 0) {
    return NextResponse.json({ error: 'ciqual_id invalide' }, { status: 400 });
  }
  if (aliasDisplay.length < 2 || aliasDisplay.length > 100) {
    return NextResponse.json(
      { error: 'alias_display doit faire 2-100 caracteres' },
      { status: 400 },
    );
  }

  const alias = normalize(aliasDisplay);
  const supa = createServiceClient() as any;

  // Verifie que le ciqual_id existe
  const { data: ciqual } = await supa
    .from('ciqual_foods')
    .select('id, name')
    .eq('id', ciqualId)
    .maybeSingle();
  if (!ciqual) {
    return NextResponse.json(
      { error: `Ciqual #${ciqualId} introuvable` },
      { status: 404 },
    );
  }

  // Upsert : si (ciqual_id, alias) existe deja, on update status →
  // 'resolved' (au cas ou il etait pending/rejected).
  const { data: existing } = await supa
    .from('ciqual_aliases')
    .select('id, status')
    .eq('ciqual_id', ciqualId)
    .eq('alias', alias)
    .maybeSingle();

  if (existing) {
    if (existing.status !== 'resolved') {
      const { data: updated, error } = await supa
        .from('ciqual_aliases')
        .update({ status: 'resolved', source: 'admin_manual' })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ...updated, _action: 'updated' });
    }
    return NextResponse.json({ ...existing, _action: 'noop' });
  }

  const { data: inserted, error } = await supa
    .from('ciqual_aliases')
    .insert({
      ciqual_id: ciqualId,
      alias,
      alias_display: aliasDisplay,
      source: 'admin_manual',
      status: 'resolved',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ...inserted, _action: 'created' });
}

/**
 * DELETE /api/admin/ciqual-aliases?id=123
 *
 * Supprime un alias (par exemple si Karine s'est trompee).
 */
export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }
  const supa = createServiceClient() as any;
  const { error } = await supa.from('ciqual_aliases').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
