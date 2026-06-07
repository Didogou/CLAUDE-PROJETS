import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/ciqual-aliases/auto-resolve
 *
 * Applique des règles automatiques pour résoudre les conflits triviaux.
 *
 * Body : { rules?: ('cuit-vs-cru')[] }   // défaut = toutes les règles
 *
 * RÈGLE 'cuit-vs-cru' (la seule pour l'instant) :
 *   Pour chaque alias en conflit (status='pending'), on regarde si
 *   l'alias contient un marqueur cru ou non, et on rejette le côté
 *   opposé chez les candidats Ciqual.
 *
 *   1) Alias NEUTRE (sans « cru ») :
 *      - On identifie les candidats cuits vs crus dans les noms Ciqual
 *      - S'il y a >= 1 cuit ET >= 1 cru → on REJETTE tous les crus
 *        (la règle métier privilégie le cuit par défaut, cf.
 *         /api/nutrition/parse RÈGLE VIANDES). Les cuits restent en
 *        pending (Karine résoudra si plusieurs cuits ambigus).
 *
 *   2) Alias avec « cru » / « crue » :
 *      - Cas inverse, demande explicite de l'utilisatrice
 *      - S'il y a >= 1 cuit ET >= 1 cru → on REJETTE tous les cuits
 *        Les crus restent en pending (Karine résoudra si plusieurs).
 *
 * Marqueurs de cuisson reconnus :
 *   cuit/cuite/grillé/poêlé/rôti/braisé/vapeur/frit/bouilli/
 *   blanchi/confit/appertisé/mijoté/à l'étouffée/au four
 *
 * Retourne :
 *   { processed: number, rejected: number, conflictsAddressed: number,
 *     byNeutralAlias: number, byRawAlias: number }
 *
 * Idempotent : si on relance, les déjà-rejected ne sont pas touchés.
 */

// Regex de détection — strict pour limiter les faux positifs
const RE_RAW = /\b(cru|crue|crues|crus)\b/i;
const RE_COOKED =
  /\b(cuit|cuite|cuits|cuites|grill[ée]|grill[ée]e|grill[ée]es|po[êe]l[ée]|po[êe]l[ée]e|po[êe]l[ée]es|r[ôo]ti|r[ôo]tie|r[ôo]tis|r[ôo]ties|brais[ée]|brais[ée]e|brais[ée]es|appert[ié]s[ée]|appert[ié]s[ée]e|appert[ié]s[ée]es|vapeur|frit|frite|frits|frites|bouilli|bouillie|bouillis|bouillies|blanchi|blanchie|blanchis|blanchies|confit|confite|confits|confites|mijot[ée]|mijot[ée]e|mijot[ée]es)\b|à l[ '’]?étouff[ée]e|au four/i;

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const body = await request.json().catch(() => ({}));
  // (rules à brancher plus tard si on ajoute d'autres règles)

  const supabase = createServiceClient();

  // 1. Récupère tous les aliases en pending (paginé)
  type Row = { id: number; alias: string; ciqual_id: number };
  const pending: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ciqual_aliases')
      .select('id, alias, ciqual_id')
      .eq('status', 'pending')
      .order('alias')
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    pending.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  // 2. Groupe par alias et garde uniquement les conflits (>1 ciqual_id)
  const byAlias = new Map<string, Row[]>();
  for (const r of pending) {
    const list = byAlias.get(r.alias) ?? [];
    list.push(r);
    byAlias.set(r.alias, list);
  }
  const conflicts: Array<{ alias: string; rows: Row[] }> = [];
  for (const [alias, rows] of byAlias) {
    if (new Set(rows.map((r) => r.ciqual_id)).size > 1) {
      conflicts.push({ alias, rows });
    }
  }

  // 3. Pour chaque conflit, on récupère les noms Ciqual des candidats
  //    et on applique la règle cuit/cru.
  const idsToReject = new Set<number>(); // ids dans ciqual_aliases
  let conflictsAddressed = 0;
  let byNeutralAlias = 0; // alias neutre → rejet des crus
  let byRawAlias = 0; // alias avec "cru" → rejet des cuits

  // Récupère les noms Ciqual concernés en une seule passe
  const allCiqualIds = [...new Set(conflicts.flatMap((c) => c.rows.map((r) => r.ciqual_id)))];
  const nameById = new Map<number, string>();
  for (let i = 0; i < allCiqualIds.length; i += 500) {
    const chunk = allCiqualIds.slice(i, i + 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ciqual_foods')
      .select('id, name')
      .in('id', chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of (data as Array<{ id: number; name: string }>) ?? []) {
      nameById.set(row.id, row.name);
    }
  }

  for (const { alias, rows } of conflicts) {
    const aliasIsRaw = RE_RAW.test(alias);

    const cooked: Row[] = [];
    const raw: Row[] = [];
    for (const r of rows) {
      const n = nameById.get(r.ciqual_id) ?? '';
      const isRaw = RE_RAW.test(n);
      const isCooked = RE_COOKED.test(n);
      if (isCooked && !isRaw) cooked.push(r);
      else if (isRaw && !isCooked) raw.push(r);
      // Si les 2 ou aucun : ambigu → on n'inclut nulle part
    }

    // On n'agit que si le conflit oppose effectivement cuit vs cru
    if (cooked.length === 0 || raw.length === 0) continue;

    if (aliasIsRaw) {
      // Alias explicite « cru » → rejet de toutes les versions cuites
      for (const r of cooked) idsToReject.add(r.id);
      byRawAlias++;
    } else {
      // Alias neutre → rejet de toutes les versions crues
      for (const r of raw) idsToReject.add(r.id);
      byNeutralAlias++;
    }
    conflictsAddressed++;
  }

  // 4. Update batch — par chunks de 200 pour éviter une requête trop grosse
  const idsArray = [...idsToReject];
  for (let i = 0; i < idsArray.length; i += 200) {
    const chunk = idsArray.slice(i, i + 200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('ciqual_aliases')
      .update({ status: 'rejected' })
      .in('id', chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    processed: conflicts.length,
    rejected: idsArray.length,
    conflictsAddressed,
    byNeutralAlias,
    byRawAlias,
  });
}
