/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { createServiceClient } from '@/lib/supabase/server';
import { generateAliasesForFood } from '@/lib/ciqual-alias-gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/admin/ciqual-aliases/generate
 *
 * Génère, via Mistral, les alias d'un LOT (chunk) d'aliments Ciqual
 * appartenant aux groupes choisis, et les insère en `status='pending'`.
 *
 * Le client appelle cette route en BOUCLE en faisant avancer `offset`
 * jusqu'à `done=true`. On traite un petit chunk par requête pour :
 *   - rester sous la limite de durée des routes (chaque chunk < ~10 s) ;
 *   - respecter la limite Mistral free (1 req/s) : throttle 1100 ms
 *     ENTRE chaque appel, séquentiel pur (jamais d'overlap).
 *
 * Body : { groups: string[], offset: number, chunk?: number, force?: boolean }
 *  - groups : noms de group_name Ciqual à traiter
 *  - offset : index de départ dans l'ensemble ordonné par id
 *  - chunk  : nb d'aliments traités dans cette requête (1-12, défaut 6)
 *  - force  : si true, regénère même les aliments qui ont déjà des alias
 *
 * Retour : { total, offset, nextOffset, done, counts, results }
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'MISTRAL_API_KEY absente du serveur (.env.local).' },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    groups?: unknown;
    offset?: unknown;
    chunk?: unknown;
    force?: unknown;
  };
  const groups = Array.isArray(body.groups)
    ? body.groups.filter((g): g is string => typeof g === 'string')
    : [];
  const offset = Math.max(0, Number(body.offset) || 0);
  const chunk = Math.min(12, Math.max(1, Number(body.chunk) || 6));
  const force = !!body.force;

  if (groups.length === 0) {
    return NextResponse.json(
      { error: 'Aucune catégorie sélectionnée.' },
      { status: 400 },
    );
  }

  const supa = createServiceClient() as any;

  // Total des aliments concernés (pour la barre de progression).
  const { count: total, error: countErr } = await supa
    .from('ciqual_foods')
    .select('id', { count: 'exact', head: true })
    .in('group_name', groups);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }

  // Page d'aliments à traiter (ordre stable par id → pagination fiable).
  const { data: foods, error: foodsErr } = await supa
    .from('ciqual_foods')
    .select('id, alim_code, name, group_name, subgroup_name')
    .in('group_name', groups)
    .order('id', { ascending: true })
    .range(offset, offset + chunk - 1);
  if (foodsErr) {
    return NextResponse.json({ error: foodsErr.message }, { status: 500 });
  }

  type Food = {
    id: number;
    alim_code: number | null;
    name: string;
    group_name: string | null;
    subgroup_name: string | null;
  };
  const page = (foods ?? []) as Food[];

  const results: Array<{
    id: number;
    name: string;
    aliases?: string[];
    skipped?: boolean;
    error?: string;
  }> = [];
  let generated = 0;
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < page.length; i++) {
    const food = page[i];

    // Skip si l'aliment a déjà des alias (idempotent / reprise), sauf --force.
    if (!force) {
      const { count: existing } = await supa
        .from('ciqual_aliases')
        .select('id', { count: 'exact', head: true })
        .eq('ciqual_id', food.id);
      if ((existing ?? 0) > 0) {
        skipped++;
        results.push({ id: food.id, name: food.name, skipped: true });
        continue;
      }
    }

    try {
      const aliases = await generateAliasesForFood(food, apiKey);
      generated += aliases.length;
      if (aliases.length > 0) {
        const rows = aliases.map((a) => ({
          ciqual_id: food.id,
          alias: a.normalized,
          alias_display: a.display,
          source: 'mistral_batch_v1',
          status: 'pending',
        }));
        const { error: insErr } = await supa
          .from('ciqual_aliases')
          .upsert(rows, { onConflict: 'ciqual_id,alias', ignoreDuplicates: true });
        if (insErr) {
          errors++;
          results.push({ id: food.id, name: food.name, error: insErr.message });
          continue;
        }
        inserted += rows.length;
      }
      results.push({ id: food.id, name: food.name, aliases: aliases.map((a) => a.display) });
    } catch (e) {
      errors++;
      results.push({
        id: food.id,
        name: food.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Throttle Mistral free (1 req/s). On dort APRÈS chaque appel réel
    // (y compris le dernier du lot) pour garantir l'écart >= 1 s même à
    // la frontière entre deux lots : le client enchaîne la requête
    // suivante immédiatement après la réponse. Les items skippés ont fait
    // `continue` plus haut → pas d'appel Mistral → pas de throttle.
    await sleep(1100);
  }

  const nextOffset = offset + page.length;
  const done = page.length === 0 || nextOffset >= (total ?? 0);

  return NextResponse.json({
    total: total ?? 0,
    offset,
    nextOffset,
    done,
    counts: { generated, inserted, skipped, errors },
    results,
  });
}
