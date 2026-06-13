import { BatchPrepaAudioClient } from '@/components/admin/BatchPrepaAudioClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Batch préparations + voix · Admin',
};

/**
 * Page admin /admin/recettes/batch-prepa-audio.
 *
 * Batch en deux actions sur toutes les recettes (skip déjà fait) :
 *   1. Extraction des préparations (Claude Vision)
 *   2. Génération des voix avec la Voix de Karine (ElevenLabs)
 * Tout le travail est piloté côté client (boucle séquentielle sur les
 * routes par-recette extract-preparation + generate-audio).
 */
export default function AdminBatchPrepaAudioPage() {
  return <BatchPrepaAudioClient />;
}
