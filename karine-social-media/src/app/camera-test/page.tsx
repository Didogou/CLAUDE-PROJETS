'use client';

import { useRouter } from 'next/navigation';
import { MealScanSheet } from '@/components/garde/MealScanSheet';

/**
 * Page de validation Phase 3 (temporaire) — ouvre directement l'expérience
 * « scan repas » in-app : caméra live en haut, scan rose, vignettes +
 * total qui défile + anneaux de projection. Accessible via le lien
 * temporaire sur l'accueil. Fermer = retour accueil.
 *
 * À retirer (avec le lien d'accueil) une fois la bascule sur le bouton 📷
 * de la BottomNav effectuée.
 */
export default function CameraTestPage() {
  const router = useRouter();
  return <MealScanSheet onClose={() => router.push('/')} />;
}
