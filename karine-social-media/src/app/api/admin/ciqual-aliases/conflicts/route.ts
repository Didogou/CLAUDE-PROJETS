import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/ciqual-aliases/conflicts
 *
 * Retourne la liste des aliases en CONFLIT — un même `alias` qui pointe
 * vers >1 `ciqual_id` distinct, dans l'ensemble `status='pending'`.
 *
 * Format de retour :
 *   {
 *     conflicts: [
 *       {
 *         alias: "côte de porc",
 *         candidates: [
 *           { ciqualId: 123, name: "Porc, côte, cuite",  kcalPer100g: 250, groupName: "viandes..." },
 *           { ciqualId: 456, name: "Porc, côte, crue",   kcalPer100g: 145, groupName: "viandes..." },
 *           ...
 *         ]
 *       },
 *       ...
 *     ],
 *     totalAliases:    1234,  // total d'aliases pending toutes lignes confondues
 *     totalConflicts:  87,    // nombre d'aliases en conflit
 *     totalResolved:   42,    // nombre d'aliases déjà resolved
 *     totalRejected:   18,    // nombre d'aliases déjà rejected
 *   }
 *
 * Utilisé par /admin/ciqual-aliases pour afficher la file de travail.
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const supabase = createServiceClient();

  // 1. Toutes les lignes pending (paginé pour bypasser la limite 1000)
  type Row = { id: number; alias: string; ciqual_id: number; status: string };
  const allPending: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ciqual_aliases')
      .select('id, alias, ciqual_id, status')
      .eq('status', 'pending')
      .order('alias')
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    allPending.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  // 2. Groupage par alias. Un conflit = alias avec >1 ciqual_id distinct.
  const byAlias = new Map<string, number[]>();
  for (const r of allPending) {
    const list = byAlias.get(r.alias) ?? [];
    if (!list.includes(r.ciqual_id)) list.push(r.ciqual_id);
    byAlias.set(r.alias, list);
  }
  const conflictAliases = [...byAlias.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([alias, ids]) => ({ alias, ciqualIds: ids }));

  // 3. Pour chaque conflit, on hydrate les candidats avec leurs détails
  //    Ciqual (nom, kcal, groupe).
  const allCiqualIds = [...new Set(conflictAliases.flatMap((c) => c.ciqualIds))];
  type CiqualRow = {
    id: number;
    name: string;
    kcal_per_100g: number | null;
    group_name: string | null;
  };
  const ciqualById = new Map<number, CiqualRow>();
  if (allCiqualIds.length > 0) {
    // Paginé aussi par sécurité (gros conflits possibles).
    for (let i = 0; i < allCiqualIds.length; i += 500) {
      const chunk = allCiqualIds.slice(i, i + 500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('ciqual_foods')
        .select('id, name, kcal_per_100g, group_name')
        .in('id', chunk);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const row of (data as CiqualRow[]) ?? []) ciqualById.set(row.id, row);
    }
  }

  const conflicts = conflictAliases.map(({ alias, ciqualIds }) => ({
    alias,
    candidates: ciqualIds
      .map((id) => {
        const c = ciqualById.get(id);
        return c
          ? {
              ciqualId: c.id,
              name: c.name,
              kcalPer100g: c.kcal_per_100g,
              groupName: c.group_name,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  }));

  // 4. Compteurs globaux pour info (paginés)
  async function countStatus(status: string): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from('ciqual_aliases')
      .select('id', { count: 'exact', head: true })
      .eq('status', status);
    return count ?? 0;
  }
  const [totalResolved, totalRejected] = await Promise.all([
    countStatus('resolved'),
    countStatus('rejected'),
  ]);

  return NextResponse.json({
    conflicts,
    totalAliases: allPending.length,
    totalConflicts: conflicts.length,
    totalResolved,
    totalRejected,
  });
}
