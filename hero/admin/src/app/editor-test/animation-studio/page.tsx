'use client'
/**
 * AnimationStudio — nouvel écran d'édition d'animation, refonte 2026-05-07.
 *
 * Distinct du Designer (`/editor-test/new-layout`) : ici l'auteur édite la
 * partie animation d'un plan (pellicules, shots, dialogues, scène) avec un
 * layout dédié 4 zones :
 *   - Rail gauche : icônes catégories (banques)
 *   - Timeline horizontale en haut : pellicules + persos par shot
 *   - Zone centrale : prompts (shots) repliables + speaker focus
 *   - Preview à droite : aperçu device (mobile/tablette) + bouton play
 *   - Banques slidables (image / persos) en panneau gauche, mutual exclusion
 *     avec la preview
 *
 * Cf. project_designer_animation_screen_redesign_2026_05_07.md pour le design
 * complet.
 *
 * Cette route coexiste avec /editor-test/new-layout (le Designer original
 * reste en place pendant la transition). L'accès se fait via un bouton
 * "Commencer l'animation" depuis l'écran 1 du Designer (à câbler).
 */

import React, { Suspense } from 'react'
import { EditorStateProvider } from '@/components/image-editor/EditorStateContext'
import { CharacterStoreProvider } from '@/lib/character-store'
import AnimationStudioInner from './AnimationStudioInner'

export default function AnimationStudioPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', color: '#888' }}>Chargement…</div>}>
      <CharacterStoreProvider>
        <EditorStateProvider initialImageUrl={null}>
          <AnimationStudioInner />
        </EditorStateProvider>
      </CharacterStoreProvider>
    </Suspense>
  )
}
