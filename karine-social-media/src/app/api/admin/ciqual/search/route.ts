import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { searchCiqualFoods } from '@/lib/ciqual';

/**
 * GET /api/admin/ciqual/search?q=...
 *
 * Recherche autocomplete dans la table Ciqual pour la page admin
 * Nutri-Score. Utilise le pipeline V3 existant :
 *  - RPC Postgres search_ciqual_foods (tokenisation + unaccent + lower)
 *  - Table ciqual_aliases (expressions naturelles validées par Karine)
 *  - Scoring de pertinence côté JS
 *
 * Auth : admin only.
 *
 * Format de retour identique à l'ancien endpoint (results: array) pour
 * compatibilité avec le picker côté client.
 */
export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // 20 = limite raisonnable pour un picker dropdown.
  const results = await searchCiqualFoods(q, 20);
  return NextResponse.json({ results });
}
