'use client'
/**
 * AnimationStudio MONO — variante refondue 2026-05-17 du Studio Animation.
 *
 * Différence vs /editor-test/animation-studio :
 *   - Plus de timeline multi-pistes (MultiTrackEditor)
 *   - Focus sur UNE pellicule à la fois
 *   - Si arrivée via "Continuer" depuis Studio Section : tuile vidéo source
 *     animée + prompt en bas (= contexte du V2V Extend)
 *   - Si arrivée via "Ajouter" : tuile image (= last frame de l'animation source)
 *     + prompt en bas (= contexte du I2V depuis lastFrame)
 *
 * La page d'origine (animation-studio) reste figée comme référence.
 */

import React, { Suspense } from 'react'
import { EditorStateProvider } from '@/components/image-editor/EditorStateContext'
import { CharacterStoreProvider } from '@/lib/character-store'
import AnimationStudioMonoInner from './AnimationStudioMonoInner'

export default function AnimationStudioMonoPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', color: '#888' }}>Chargement…</div>}>
      <CharacterStoreProvider>
        <EditorStateProvider initialImageUrl={null}>
          <AnimationStudioMonoInner />
        </EditorStateProvider>
      </CharacterStoreProvider>
    </Suspense>
  )
}
