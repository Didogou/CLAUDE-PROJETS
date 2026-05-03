'use client'
/**
 * PlanWizard — composant racine + hook pour guider la construction d'un plan.
 *
 * Navigation :
 *   Step 1 (image) → Step 2 (dashboard) → sous-wizard (variants, derivations...)
 *                                      ← retour dashboard après chaque sous-wizard
 *
 * Chaque étape REMPLACE la précédente dans la modale (pas de dépliement).
 * Le wizard maintient un `pendingCleanup: Set<string>` qui accumule les URLs
 * des images générées puis abandonnées. À la fermeture finale, un DELETE batch
 * Supabase est envoyé pour libérer le storage.
 *
 * Usage :
 *   const wiz = usePlanWizard()
 *   // Dans JSX :  {wiz.modal}
 *   // Déclencher :
 *   wiz.open({
 *     mode: 'full-plan',
 *     section, reference: { type: 'plan', id: '0' },
 *     prompt, promptNegative, style, aspectRatio,
 *     existingImage: { url, checkpointKey },
 *     storagePathPrefix: 'plans/sectionId/0',
 *     onImageSelected: async (url, key) => { /* persiste *\/ },
 *     onVariantsSelected: async (urls) => { /* persiste *\/ },
 *   })
 */
import React, { useState } from 'react'
import type { PlanWizardOpenParams, PlanWizardState, WizardStep } from './types'
import Step1Image from './steps/Step1_Image'
import Step2Dashboard from './steps/Step2_Dashboard'
import SubVariants from './steps/SubVariants'
import SubExtractCharacter from './steps/SubExtractCharacter'
import SubDerivations from './steps/SubDerivations'
import SubPanorama360 from './steps/SubPanorama360'

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePlanWizard() {
  const [state, setState] = useState<PlanWizardState | null>(null)

  const open = (params: PlanWizardOpenParams) => {
    setState({
      params,
      step: 'image',
      selectedImage: null,
      keptVariants: [],
      pendingCleanup: new Set<string>(),
    })
  }

  const closeWithCleanup = async () => {
    const urls = state ? Array.from(state.pendingCleanup) : []
    state?.params.onClose?.()
    setState(null)
    if (urls.length > 0) {
      try {
        await fetch('/api/storage/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }) })
        console.log('[PlanWizard] Cleanup : supprimé', urls.length, 'images non conservées')
      } catch (err) { console.warn('[PlanWizard] Cleanup échoué :', err) }
    }
  }

  const modal = state ? (
    <PlanWizardModal
      state={state}
      setState={setState}
      onClose={closeWithCleanup}
    />
  ) : null

  return { open, close: closeWithCleanup, modal, isOpen: !!state }
}

// ── Modale racine ────────────────────────────────────────────────────────────

function PlanWizardModal({
  state,
  setState,
  onClose,
}: {
  state: PlanWizardState
  setState: React.Dispatch<React.SetStateAction<PlanWizardState | null>>
  onClose: () => void
}) {
  // Helpers de navigation
  const goStep = (step: WizardStep) => setState(prev => prev ? { ...prev, step } : null)
  const addCleanup = (urls: string[]) => {
    if (urls.length === 0) return
    setState(prev => {
      if (!prev) return null
      const next = new Set(prev.pendingCleanup)
      for (const u of urls) next.add(u)
      return { ...prev, pendingCleanup: next }
    })
  }

  // ── Step 1 handlers ──
  const handleImageSelected = async (url: string, checkpointKey: string, discarded: string[]) => {
    // Persiste côté caller (sauvegarde DB section/plan/etc.)
    await state.params.onImageSelected(url, checkpointKey)
    // Planifie le cleanup des rejetées
    addCleanup(discarded)
    // Set l'image figée + transition vers le dashboard (ou fermeture si image-only)
    setState(prev => prev ? { ...prev, selectedImage: { url, checkpointKey } } : null)
    if (state.params.mode === 'image-only') {
      // Cleanup immédiat + fermeture
      setTimeout(onClose, 50)
    } else {
      goStep('dashboard')
    }
  }

  // ── Dashboard handlers ──
  const handleLaunchSub = (step: Exclude<WizardStep, 'image' | 'dashboard'>) => goStep(step)
  const handleBackToImage = () => {
    if (!confirm('Changer l\'image va remettre tout à plat. Les variantes actuelles seront supprimées. Confirmer ?')) return
    // Purge les variantes gardées au cleanup + reset
    addCleanup(state.keptVariants)
    setState(prev => prev ? { ...prev, step: 'image', selectedImage: null, keptVariants: [] } : null)
  }

  // ── SubVariants handlers ──
  const handleVariantsCompleted = async (kept: string[], discarded: string[]) => {
    // Persiste côté caller
    await state.params.onVariantsSelected?.(kept)
    // Ajoute les URLs rejetées au cleanup
    addCleanup(discarded)
    // Ajoute les gardées au state
    setState(prev => prev ? { ...prev, keptVariants: [...prev.keptVariants, ...kept] } : null)
    goStep('dashboard')
  }
  const handleVariantsCancel = () => {
    // Retour dashboard. Les URLs déjà générées (même non validées) partiront au
    // cleanup via les fallbacks du sous-wizard si implémentés.
    goStep('dashboard')
  }

  // ── ExtractCharacter handlers ──
  const handleCharacterExtracted = async (url: string) => {
    await state.params.onCharacterExtracted?.(url)
    goStep('dashboard')
  }

  // ── Derivations handler ──
  const handleDerivationsGenerated = async (orderedUrls: string[]) => {
    await state.params.onDerivationsGenerated?.(orderedUrls)
    goStep('dashboard')
  }

  // ── Panorama 360° handler (route vers scene ou choice selon le mode) ──
  const handlePanorama360Generated = async (mode: 'scene' | 'choice', panoramaUrl: string) => {
    await state.params.onPanorama360Generated?.(mode, panoramaUrl)
    goStep('dashboard')
  }
  const handlePanorama360Composed = async (panoramaUrl: string, composition: import('./types').SceneComposition) => {
    await state.params.onPanorama360Composed?.(panoramaUrl, composition)
    goStep('dashboard')
  }
  const handlePanorama360Baked = async (bakedUrl: string, composition: import('./types').SceneComposition) => {
    await state.params.onPanorama360Baked?.(bakedUrl, composition)
    goStep('dashboard')
  }

  // ── Rendu selon l'étape ──
  let content: React.ReactNode
  switch (state.step) {
    case 'image':
      content = <Step1Image params={state.params} onImageSelected={handleImageSelected} onClose={onClose} />
      break
    case 'dashboard':
      content = <Step2Dashboard state={state} onLaunchSubWizard={handleLaunchSub} onClose={onClose} onBackToImage={handleBackToImage} />
      break
    case 'variants':
      content = <SubVariants state={state} onCompleted={handleVariantsCompleted} onCancel={handleVariantsCancel} />
      break
    case 'extract_character':
      content = <SubExtractCharacter state={state} onCompleted={handleCharacterExtracted} onCancel={() => goStep('dashboard')} />
      break
    case 'derivations':
      content = <SubDerivations state={state} onCompleted={handleDerivationsGenerated} onCancel={() => goStep('dashboard')} />
      break
    case 'panorama_360':
      content = <SubPanorama360
        state={state}
        onCompleted={handlePanorama360Generated}
        onComposed={handlePanorama360Composed}
        onBaked={handlePanorama360Baked}
        onCancel={() => goStep('dashboard')}
      />
      break
    default:
      // Sous-wizards à venir (derivations, travelling, etc.)
      content = (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Sous-wizard <code>{state.step}</code> — bientôt disponible
          </div>
          <button onClick={() => goStep('dashboard')} style={{ fontSize: '0.75rem', padding: '0.4rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'pointer' }}>
            ← Retour dashboard
          </button>
        </div>
      )
  }

  // Conteneur modale — pas de fermeture par clic extérieur pour éviter
  // de perdre des générations en cours par mégarde. Fermeture uniquement
  // via les boutons explicites dans chaque étape.
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3500, background: '#000000ee', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', overflowY: 'auto' }}>
      <div style={{ background: 'var(--surface)', borderRadius: '8px', padding: '1rem 1.2rem', maxWidth: '1400px', width: '100%', maxHeight: '95vh', overflowY: 'auto' }}>
        {content}
      </div>
    </div>
  )
}
