import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { createServiceClient } from '@/lib/supabase/server';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Version actuelle du texte de consentement Art. 9 RGPD (donnees sante).
 * À incrementer si on modifie significativement le texte affiche dans la
 * modale ConsentHealthModal. Permet de re-demander le consentement aux
 * utilisatrices existantes quand le scope du traitement change.
 */
const CURRENT_VERSION = 1;

/**
 * POST /api/profile/consent-health
 *
 * Enregistre le consentement explicite Art. 9 RGPD pour le traitement
 * des donnees de sante (poids, taille, sexe, objectif perte). Appele
 * par ConsentHealthModal apres l'utilisatrice a coche la case.
 *
 * DELETE : retrait du consentement → on remet a null + on supprime
 * les donnees de sante deja saisies (poids, taille, sexe, objectif).
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  }
  const supabase = createServiceClient();
  const { error } = await (supabase as any)
    .from('profiles')
    .update({
      consent_health_at: new Date().toISOString(),
      consent_health_version: CURRENT_VERSION,
    })
    .eq('id', user.id);
  if (error) {
    console.error('[api/profile/consent-health POST]', error.message);
    return NextResponse.json(
      { error: 'Impossible d\'enregistrer le consentement.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, version: CURRENT_VERSION });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
  }
  const supabase = createServiceClient();
  // RGPD Art. 7-3 : le retrait du consentement doit etre aussi simple
  // que son recueil + supprimer les donnees concernees.
  const { error: errProfile } = await (supabase as any)
    .from('profiles')
    .update({
      consent_health_at: null,
      consent_health_version: null,
    })
    .eq('id', user.id);
  if (errProfile) {
    console.error('[api/profile/consent-health DELETE profile]', errProfile.message);
    return NextResponse.json(
      { error: 'Retrait impossible.' },
      { status: 500 },
    );
  }
  // Supprime les donnees de sante saisies (table user_nutrition_targets
  // si elle existe — log warning sinon, ne bloque pas le retrait).
  const { error: errTargets } = await (supabase as any)
    .from('user_nutrition_targets')
    .delete()
    .eq('user_id', user.id);
  if (errTargets && errTargets.code !== '42P01') {
    console.warn('[api/profile/consent-health DELETE targets]', errTargets.message);
  }
  return NextResponse.json({ ok: true });
}
