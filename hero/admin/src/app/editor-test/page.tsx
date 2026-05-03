/**
 * /editor-test → redirect vers /editor-test/new-layout (nouveau Designer 2-phases).
 *
 * L'ancienne page de test (banque de scènes + 5 scénarios POC + ImageEditor legacy)
 * est archivée dans l'historique git. Tout le développement actuel se fait sur le
 * nouveau Designer (modèle Base creation / Editing).
 *
 * Si tu as besoin de récupérer l'ancienne page (rare) :
 *   git log --all --oneline -- src/app/editor-test/page.tsx
 */
import { redirect } from 'next/navigation'

export default function EditorTestRedirect() {
  redirect('/editor-test/new-layout')
}
