import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/current-user';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/track-view
 *
 * Logge une vue utilisateur dans la table page_views. Appelé par le
 * composant <TrackView /> au mount sur chaque page suivie (détail
 * recette, détail menu, jour menu, etc.).
 *
 * Pas d'authentification requise : on tracke aussi les visiteurs
 * anonymes (user_id=null). On capture le rôle au moment de la vue
 * dans `role_snapshot` pour pouvoir calculer les ratios abonné/anonyme
 * sans rejointure coûteuse sur profiles.
 *
 * Body JSON :
 *   {
 *     path: string,                                 // ex. "/recettes/4-salades"
 *     targetType?: 'recipe'|'menu'|'tip'|'advice'|'page',
 *     targetId?: string,                            // slug ou id
 *     referrer?: string
 *   }
 *
 * Fail-soft : si l'insertion plante (migration non appliquée, etc.),
 * on log et on renvoie 200 — il ne faut JAMAIS qu'un track casse la
 * page utilisatrice.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.path !== 'string' || body.path.length > 500) {
      return NextResponse.json({ ok: true }); // silencieux
    }

    // Capture le rôle pour analytics. getCurrentUser fait l'auth check
    // côté serveur (cookie session Supabase). Anonyme = pas de session.
    const user = await getCurrentUser();
    const userId = user.id ?? null;
    const roleSnapshot = (() => {
      if (user.effectiveRole === 'admin') return 'admin';
      if (user.effectiveRole === 'patient') return 'patient';
      if (user.effectiveRole === 'subscriber') return 'subscriber';
      if (user.isAuthenticated) return 'visitor';
      return 'anonymous';
    })();

    const supa = createServiceClient() as any;
    const payload = {
      user_id: userId,
      path: body.path,
      target_type:
        typeof body.targetType === 'string' &&
        ['recipe', 'menu', 'tip', 'advice', 'page'].includes(body.targetType)
          ? body.targetType
          : null,
      target_id:
        typeof body.targetId === 'string' && body.targetId.length <= 200
          ? body.targetId
          : null,
      role_snapshot: roleSnapshot,
      referrer:
        typeof body.referrer === 'string' && body.referrer.length <= 500
          ? body.referrer
          : null,
    };

    const { error } = await supa.from('page_views').insert(payload);
    if (error) {
      // Migration pas encore appliquée ? On log et on continue.
      console.warn('[track-view] insert failed', error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Aucun cas où on doit faire échouer le tracking côté client.
    console.warn('[track-view] unexpected', e);
    return NextResponse.json({ ok: true });
  }
}
