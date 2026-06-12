import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { callMistralJson } from '@/lib/mistral';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/audit-ciqual/judge
 *
 * Body : { ingredient_label: string, ciqual_name: string }
 * Output : { verdict: 'coherent' | 'incoherent' | 'unsure',
 *            reason: string }
 *
 * Le client doit espacer ses appels d'au moins 1.1s (Mistral free
 * tier = 1 req/s strict, cf. memory feedback_mistral_rate_limit).
 * On ne throttle PAS côté serveur — le serveur Vercel pouvant être
 * appelé en parallèle depuis plusieurs onglets, c'est au client de
 * gérer son rythme.
 */

const SYSTEM = `Tu es un expert en nutrition francaise. Tu compares deux noms d'aliments :
- INGREDIENT : ce qu'a saisi un cuisinier (label libre)
- CIQUAL : le nom officiel de la table CIQUAL (ANSES) qui a ete matche

Tu dois juger si le match est COHERENT : est-ce que l'aliment CIQUAL
correspond bien a ce qu'a voulu dire le cuisinier ?

Reponds en JSON STRICT : {"verdict":"coherent"|"incoherent"|"unsure","reason":"..."}

Regles :
- "coherent" : meme aliment, possiblement avec qualifier de preparation
  (cru/cuit/seche/etc.). Ex: "tomate" / "Tomate, crue" = coherent.
- "incoherent" : aliment different ou variete tres differente.
  Ex: "banane" / "Banane plantain, crue" = incoherent (plantain est
  une variete distincte, cuite comme legume).
  Ex: "chocolat noir" / "Chocolat blanc" = incoherent.
- "unsure" : ambigu, manque de contexte. Ex: "lait" / "Lait demi-ecreme".

La "reason" doit etre TRES courte (< 80 caracteres), en francais.`;

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    ingredient_label?: string;
    ciqual_name?: string;
  };
  const label = (body.ingredient_label ?? '').trim();
  const ciqualName = (body.ciqual_name ?? '').trim();
  if (!label || !ciqualName) {
    return NextResponse.json(
      { error: 'ingredient_label et ciqual_name requis' },
      { status: 400 },
    );
  }

  const userMsg = `INGREDIENT: ${label}\nCIQUAL: ${ciqualName}`;

  let raw = '';
  try {
    const res = await callMistralJson(SYSTEM, userMsg, {
      maxTokens: 200,
      timeoutMs: 15_000,
    });
    raw = res.content;
  } catch (e) {
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 502 },
    );
  }

  // Parse defensif : Mistral peut renvoyer du JSON avec champs manquants
  // ou un verdict invalide. On normalise.
  let parsed: { verdict?: string; reason?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { verdict: 'unsure', reason: 'Reponse Mistral non-JSON' },
    );
  }

  const verdictRaw = String(parsed.verdict ?? '').toLowerCase().trim();
  const verdict =
    verdictRaw === 'coherent' || verdictRaw === 'incoherent' || verdictRaw === 'unsure'
      ? verdictRaw
      : 'unsure';
  const reason = String(parsed.reason ?? '').slice(0, 200);

  return NextResponse.json({ verdict, reason });
}
