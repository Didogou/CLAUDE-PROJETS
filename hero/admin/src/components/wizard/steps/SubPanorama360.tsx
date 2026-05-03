'use client'
/**
 * Sous-wizard "Panorama 360°" du PlanWizard.
 *
 * Génère un panorama équirectangulaire 2:1 (2048×1024 par défaut) via
 * SeamlessTile + MakeCircularVAE (bords gauche/droite connectés) + LoRA
 * 360Redmond pour la cohérence équirectangulaire.
 *
 * Preview dans le wizard : affichage flat de l'image (on voit l'étalement
 * équirectangulaire typique). Un bouton "Ouvrir dans Panoraven" permet de
 * visualiser en vraie 360° immersive (service web gratuit).
 *
 * Un viewer 3D intégré (Three.js sphere) sera ajouté dans une itération
 * future — pour V1 on délègue la visualisation 360° à Panoraven.
 */
import React, { useState } from 'react'
import type { PlanWizardState, SceneComposition } from '../types'
import { CHECKPOINTS } from '@/lib/comfyui'
import { generatePanorama360 } from '../helpers/generatePanorama360'
import { bakePanorama360 } from '../helpers/bakePanorama360'
import Pano360Composer from '../common/Pano360Composer'

export type Panorama360Mode = 'scene' | 'choice'

export interface SubPanorama360Props {
  state: PlanWizardState
  /** Callback invoqué avec le mode + l'URL (pano validé seul, sans composition). */
  onCompleted: (mode: Panorama360Mode, panoramaUrl: string) => void
  /** Callback invoqué après composition : pano vide + placements NPCs/Items. */
  onComposed?: (panoramaUrl: string, composition: SceneComposition) => void
  /** Callback invoqué après baking (persos intégrés via inpaint IA). */
  onBaked?: (bakedUrl: string, composition: SceneComposition) => void
  onCancel: () => void
}

type Stage = 'config' | 'generating' | 'review' | 'compose'

// Nom exact du fichier tel qu'hébergé sur HuggingFace : artificialguybr/360Redmond
// → https://huggingface.co/artificialguybr/360Redmond/blob/main/View360.safetensors
const DEFAULT_LORA = 'View360.safetensors'

/**
 * Tags auto-injectés selon le mode :
 * - 'scene'  : perso principal visible au centre (cinéma, on observe)
 * - 'choice' : POV 1ère personne (joueur = héros, regarde autour)
 */
const MODE_PROMPT_TAGS: Record<Panorama360Mode, string> = {
  scene: 'main character visible at the center, cinematic scene composition, third-person view, subject standing in middle ground, 360, 360view, equirectangular panoramic view',
  choice: 'first person POV, scene seen from the center, no visible main character, immersive viewpoint, 360, 360view, equirectangular panoramic spherical view',
}

/**
 * Strength LoRA par défaut selon le mode.
 * - 'scene'  : baisse à 0.35 pour laisser SDXL respecter le perso central
 * - 'choice' : garde 0.65 (pure environnement, LoRA 360 peut dominer)
 */
const MODE_LORA_STRENGTH: Record<Panorama360Mode, number> = {
  scene: 0.35,
  choice: 0.65,
}

/** Placeholder de prompt adapté au mode. */
const MODE_PLACEHOLDERS: Record<Panorama360Mode, string> = {
  scene: 'ex : Travis standing at the center of the Freaks crew, surrounded by gang members in a night park, confrontation scene, sodium streetlights',
  choice: 'ex : night park seen from Travis POV, surrounded by hostile gang members, lampposts in all directions, atmospheric summer night',
}

const MODE_LABELS: Record<Panorama360Mode, { emoji: string; title: string; desc: string }> = {
  scene: {
    emoji: '🎭',
    title: 'Plan de scène (3ème personne)',
    desc: 'Le perso principal est visible dans la scène, on l\'observe depuis la sphère. Idéal pour moments cinématiques.',
  },
  choice: {
    emoji: '👁',
    title: 'Plan de choix (1ère personne)',
    desc: 'POV immersive : le joueur DEVIENT le héros et regarde autour de lui. Idéal pour moments interactifs.',
  },
}

const STYLE_OPTIONS: { key: string; label: string }[] = [
  { key: 'realistic',    label: 'Réaliste (défaut)' },
  { key: 'photo',        label: '📷 Photo (grain, naturel)' },
  { key: 'bnw',          label: '⚫ Noir & blanc cinéma' },
  { key: 'comic',        label: '💥 BD / Comic' },
  { key: 'manga',        label: '🎌 Manga / Anime' },
  { key: 'dark_fantasy', label: '🗡 Dark fantasy' },
  { key: 'sketch',       label: '✏️ Croquis' },
]

export default function SubPanorama360({ state, onCompleted, onComposed, onBaked, onCancel }: SubPanorama360Props) {
  const [stage, setStage] = useState<Stage>('config')
  const [mode, setMode] = useState<Panorama360Mode>('choice')
  const [customPrompt, setCustomPrompt] = useState(state.params.prompt)
  const [style, setStyle] = useState(state.params.style || 'realistic')
  const [useLora, setUseLora] = useState(true)
  const [loraStrength, setLoraStrength] = useState(MODE_LORA_STRENGTH.choice)
  const [loraFilename, setLoraFilename] = useState(DEFAULT_LORA)
  /** Désactivé par défaut : incompatible GPU Blackwell (RTX 50 series).
   *  Sans lui, légère couture visible au raccord mais pano fonctionnel.
   *  L'utilisateur peut re-cocher s'il est sur un GPU compatible (30/40 series). */
  const [useCircularVae, setUseCircularVae] = useState(false)
  /** NPCs sélectionnés pour injection FaceID (mode 'scene' uniquement). */
  const [selectedNpcIds, setSelectedNpcIds] = useState<Set<string>>(new Set())
  const [panoramaUrl, setPanoramaUrl] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** NPCs candidats : ceux qui ont un portrait_url (sans, FaceID ne peut pas fonctionner). */
  const availableNpcs = (state.params.npcs ?? []).filter(n => !!n.portrait_url)
  function toggleNpc(id: string) {
    setSelectedNpcIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  /** Bascule mode + ajuste strength LoRA au défaut recommandé pour ce mode. */
  function switchMode(m: Panorama360Mode) {
    setMode(m)
    setLoraStrength(MODE_LORA_STRENGTH[m])
  }

  const checkpoint = state.selectedImage?.checkpointKey
    ? (CHECKPOINTS.find(c => c.key === state.selectedImage!.checkpointKey) ?? CHECKPOINTS[0])
    : CHECKPOINTS[0]

  async function handleLaunch() {
    setError(null); setRunning(true); setStage('generating'); setPanoramaUrl(null)
    try {
      const modeTags = MODE_PROMPT_TAGS[mode]
      const finalPrompt = customPrompt.trim() + (customPrompt.includes('360') ? '' : `, ${modeTags}`)
      // FaceID persos : seulement en mode 'scene' (en mode 'choice', joueur = héros, pas de persos)
      const characters = mode === 'scene'
        ? [...selectedNpcIds]
            .map(id => availableNpcs.find(n => n.id === id))
            .filter((n): n is NonNullable<typeof n> => !!n && !!n.portrait_url)
            .map(n => ({ portraitUrl: n.portrait_url!, name: n.name, weight: 0.7 }))
        : undefined
      const url = await generatePanorama360({
        checkpoint: checkpoint.filename,
        promptPositive: finalPrompt,
        promptNegative: state.params.promptNegative,
        style,
        width: 2048,
        height: 1024,
        lora360: useLora ? loraFilename : undefined,
        loraStrengthModel: loraStrength,
        loraStrengthClip: 1.0,
        useCircularVae,
        characters,
        steps: state.params.steps ?? 35,
        cfg: state.params.cfg ?? 7,
        storagePath: `${state.params.storagePathPrefix}_pano360_${Date.now()}`,
      })
      setPanoramaUrl(url)
      setStage('review')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // Auto-détection erreur Blackwell sur MakeCircularVAE → suggère la désactivation
      if (/MakeCircularVAE|CUDA.*invalid argument/i.test(msg) && useCircularVae) {
        setError(msg + '\n\n💡 Auto-fix : décoche "VAE circulaire" ci-dessous et relance (GPU Blackwell incompatible avec MakeCircularVAE). Tu auras une légère couture au raccord, acceptable pour test.')
        setUseCircularVae(false)
      } else {
        setError(msg)
      }
      setStage('config')
    } finally {
      setRunning(false)
    }
  }

  const panoravenUrl = panoramaUrl
    ? `https://www.panoraven.com/en/free-360-viewer?panorama=${encodeURIComponent(panoramaUrl)}`
    : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
        <span style={{ color: '#b48edd', fontWeight: 'bold', fontSize: '0.95rem' }}>🌐 Sous-wizard — Panorama 360° immersif</span>
        <button onClick={onCancel} disabled={running} style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: running ? 'wait' : 'pointer' }}>← Retour dashboard</button>
      </div>

      {/* CONFIG */}
      {stage === 'config' && (
        <>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            Génère un panorama équirectangulaire 2048×1024 (ratio 2:1) utilisable dans un viewer 3D sphérique. Les bords gauche/droite se connectent automatiquement (seamless wraparound).
          </div>

          {/* Mode toggle : scène vs choix */}
          <div style={{ background: 'var(--surface-2)', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--foreground)', fontWeight: 'bold' }}>Type de panorama</div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {(['scene', 'choice'] as Panorama360Mode[]).map(m => {
                const info = MODE_LABELS[m]
                const active = mode === m
                return (
                  <button key={m} onClick={() => switchMode(m)}
                    style={{ flex: '1 1 220px', textAlign: 'left', padding: '0.6rem 0.7rem', borderRadius: '4px', border: `1px solid ${active ? '#b48edd' : 'var(--border)'}`, background: active ? 'rgba(180,142,221,0.12)' : 'var(--surface)', color: active ? '#b48edd' : 'var(--foreground)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: active ? 'bold' : 'normal' }}>
                    {info.emoji} {info.title}
                    <div style={{ fontSize: '0.58rem', fontWeight: 'normal', opacity: 0.8, marginTop: '0.15rem', lineHeight: 1.4 }}>
                      {info.desc}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Style + NPCs (uniquement en mode scène pour FaceID) */}
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 220 }}>
              <span>🎨 Style</span>
              <select value={style} onChange={e => setStyle(e.target.value)}
                style={{ fontSize: '0.7rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem 0.5rem', color: 'var(--foreground)' }}>
                {STYLE_OPTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {/* Multi-select NPCs : uniquement en mode scène (FaceID des persos visibles) */}
          {mode === 'scene' && availableNpcs.length > 0 && (
            <div style={{ background: 'var(--surface-2)', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--foreground)', fontWeight: 'bold' }}>🧍 Persos à injecter via FaceID ({selectedNpcIds.size}/{availableNpcs.length})</div>
              <div style={{ fontSize: '0.58rem', color: 'var(--muted)', opacity: 0.8 }}>
                Chaque perso coché sera "suggéré" à SDXL via IPAdapter FaceID. Attention : combiné avec le LoRA 360, les visages peuvent être approximatifs (pas de contrôle précis sur leur position dans la sphère).
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {availableNpcs.map(npc => {
                  const selected = selectedNpcIds.has(npc.id)
                  return (
                    <label key={npc.id} onClick={() => toggleNpc(npc.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.5rem', borderRadius: '4px', border: `1px solid ${selected ? '#b48edd' : 'var(--border)'}`, background: selected ? 'rgba(180,142,221,0.12)' : 'var(--surface)', cursor: 'pointer', fontSize: '0.65rem', color: selected ? '#b48edd' : 'var(--foreground)', fontWeight: selected ? 'bold' : 'normal' }}>
                      <input type="checkbox" checked={selected} onChange={() => {}} style={{ cursor: 'pointer' }} />
                      {npc.portrait_url && <img src={npc.portrait_url} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} />}
                      {npc.name}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          {mode === 'scene' && availableNpcs.length === 0 && (
            <div style={{ fontSize: '0.62rem', color: 'var(--muted)', padding: '0.4rem 0.6rem', background: 'var(--surface-2)', borderRadius: '4px' }}>
              ℹ Aucun NPC avec portrait_url à injecter. Crée des NPCs d'abord avec des portraits pour activer FaceID.
            </div>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
            Prompt {mode === 'scene' ? '(décris la scène avec le perso principal visible)' : '(décris la scène comme vue depuis le centre — POV héros)'}
            <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} rows={4}
              placeholder={MODE_PLACEHOLDERS[mode]}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.4rem 0.5rem', color: 'var(--foreground)', fontSize: '0.7rem', fontFamily: 'inherit', resize: 'vertical' }} />
            <span style={{ fontSize: '0.58rem', opacity: 0.7 }}>
              💡 Tags auto-injectés selon le mode : <code>{MODE_PROMPT_TAGS[mode].slice(0, 90)}…</code>
            </span>
          </label>

          {/* LoRA config */}
          <div style={{ background: 'var(--surface-2)', borderRadius: '6px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--foreground)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={useLora} onChange={e => setUseLora(e.target.checked)} />
              Utiliser le LoRA <code style={{ fontSize: '0.65rem' }}>360Redmond</code> (recommandé)
            </label>
            {useLora && (
              <>
                <label style={{ fontSize: '0.65rem', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  Filename du LoRA dans ComfyUI/models/loras/
                  <input type="text" value={loraFilename} onChange={e => setLoraFilename(e.target.value)}
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.25rem 0.4rem', color: 'var(--foreground)', fontSize: '0.65rem', fontFamily: 'monospace' }} />
                </label>
                <label style={{ fontSize: '0.65rem', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <span>Strength du LoRA : <strong style={{ color: '#b48edd' }}>{loraStrength.toFixed(2)}</strong></span>
                  <input type="range" min={0.2} max={1.0} step={0.05} value={loraStrength} onChange={e => setLoraStrength(Number(e.target.value))} style={{ width: '100%', maxWidth: 300 }} />
                  <span style={{ fontSize: '0.58rem', opacity: 0.7 }}>0.6 = défaut recommandé. Plus haut = plus "equirectangular" mais peut dégrader le réalisme.</span>
                </label>
                <div style={{ fontSize: '0.58rem', color: 'var(--muted)', opacity: 0.75, lineHeight: 1.4 }}>
                  📥 Télécharger si manquant : <a href="https://huggingface.co/artificialguybr/360Redmond/blob/main/View360.safetensors" target="_blank" rel="noreferrer" style={{ color: '#b48edd' }}>View360.safetensors (913 Mo)</a> → place dans <code>ComfyUI/models/loras/</code>
                </div>
              </>
            )}
          </div>

          <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
            Checkpoint : <code>{checkpoint.label}</code>
            <span style={{ marginLeft: '0.6rem', opacity: 0.7 }}>• Custom nodes requis : <code>ComfyUI-seamless-tiling</code> (spinagon)</span>
          </div>

          {/* Toggle VAE circulaire : désactivé par défaut (Blackwell incompatible) */}
          <label title="VAE circulaire permet un raccord parfait gauche/droite. Désactivé par défaut pour compatibilité GPU Blackwell (RTX 50 series). Coche si tu as une RTX 30/40."
            style={{ fontSize: '0.65rem', color: useCircularVae ? 'var(--accent)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <input type="checkbox" checked={useCircularVae} onChange={e => setUseCircularVae(e.target.checked)} />
            VAE circulaire (raccord parfait — ne coche que si RTX 30/40, pas RTX 50 Blackwell)
          </label>

          {error && <div style={{ fontSize: '0.7rem', color: '#c94c4c', padding: '0.4rem 0.6rem', background: 'rgba(201,76,76,0.1)', border: '1px solid #c94c4c33', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>⚠ {error}</div>}

          <button onClick={() => void handleLaunch()} disabled={!customPrompt.trim()}
            style={{ alignSelf: 'flex-start', background: '#b48edd', border: 'none', borderRadius: '4px', padding: '0.5rem 1.2rem', color: '#0f0f14', fontSize: '0.75rem', fontWeight: 'bold', cursor: customPrompt.trim() ? 'pointer' : 'not-allowed', opacity: customPrompt.trim() ? 1 : 0.5 }}>
            ▶ Générer le pano 360° (~2-4 min)
          </button>
        </>
      )}

      {/* GENERATING */}
      {stage === 'generating' && (
        <div style={{ padding: '2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.8rem', alignItems: 'center' }}>
          <div style={{ fontSize: '1.2rem' }}>⏳</div>
          <div style={{ fontSize: '0.8rem', color: '#b48edd', fontWeight: 'bold' }}>
            Génération du {MODE_LABELS[mode].emoji} {MODE_LABELS[mode].title}…
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            SDXL + SeamlessTile + {useLora ? `LoRA 360Redmond (${loraStrength.toFixed(2)})` : 'sans LoRA'}
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--muted)', opacity: 0.7 }}>
            Temps estimé : 2-4 min (2048×1024 SDXL).
          </div>
        </div>
      )}

      {/* REVIEW */}
      {stage === 'review' && panoramaUrl && (
        <>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            ✓ Panorama équirectangulaire généré. L&apos;image ci-dessous est l&apos;étalement flat — elle est conçue pour être wrappée sur une sphère 3D.
          </div>
          <div style={{ width: '100%', overflow: 'hidden', background: '#000', borderRadius: '6px', border: '2px solid #b48edd' }}>
            <img src={panoramaUrl} alt="panorama 360" style={{ display: 'block', width: '100%', height: 'auto' }} />
          </div>
          <div style={{ fontSize: '0.62rem', color: 'var(--muted)', opacity: 0.75, lineHeight: 1.4 }}>
            💡 Pour tester en 3D immersif : ouvre le pano dans Panoraven (viewer 3D web gratuit). L&apos;URL Supabase est passée dans le paramètre, tu navigues à la souris.
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => setStage('config')} style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'pointer' }}>
              ← Retour config
            </button>
            <button onClick={() => void handleLaunch()} style={{ fontSize: '0.7rem', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
              ↻ Regénérer (nouveau seed)
            </button>
            <a href={panoravenUrl} target="_blank" rel="noreferrer"
              style={{ fontSize: '0.72rem', fontWeight: 'bold', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid #7ab8d8', background: 'rgba(122,184,216,0.1)', color: '#7ab8d8', textDecoration: 'none', cursor: 'pointer' }}>
              🌐 Tester en 3D (Panoraven)
            </a>
            {onComposed && (
              <button onClick={() => setStage('compose')}
                title="Place des NPCs et objets sur le pano (architecture décor+acteurs)"
                style={{ fontSize: '0.72rem', fontWeight: 'bold', padding: '0.45rem 0.9rem', borderRadius: '4px', border: '1px solid #b48edd', background: 'rgba(180,142,221,0.1)', color: '#b48edd', cursor: 'pointer' }}>
                🎬 Composer (placer acteurs/objets)
              </button>
            )}
            <button onClick={() => onCompleted(mode, panoramaUrl)}
              style={{ marginLeft: 'auto', background: '#b48edd', border: 'none', borderRadius: '4px', padding: '0.5rem 1.2rem', color: '#0f0f14', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}>
              ✓ Valider {mode === 'scene' ? 'plan de scène' : 'plan de choix'}
            </button>
          </div>
        </>
      )}

      {/* COMPOSE — placement d'acteurs/objets sur le pano */}
      {stage === 'compose' && panoramaUrl && onComposed && (
        <Pano360Composer
          panoramaUrl={panoramaUrl}
          npcs={(state.params.npcs ?? []).filter(n => !!n.portrait_url)}
          items={(state.params.items ?? []).filter(i => !!i.illustration_url)}
          storagePathPrefix={state.params.storagePathPrefix}
          onPanoramaReplaced={newUrl => setPanoramaUrl(newUrl)}
          onSave={(composition) => onComposed(panoramaUrl, composition)}
          // Option baking IA si le parent accepte (onBaked fourni)
          onBake={onBaked ? async (composition, onProgress) => {
            return await bakePanorama360({
              panoramaUrl,
              placements: composition.npcs,
              npcs: state.params.npcs ?? [],
              itemPlacements: composition.items,
              items: state.params.items ?? [],
              checkpoint: checkpoint.filename,
              sceneContext: state.params.prompt,
              promptNegative: state.params.promptNegative,
              storagePathPrefix: state.params.storagePathPrefix,
              onProgress,
            })
          } : undefined}
          onSaveBaked={onBaked ? (bakedUrl, composition) => onBaked(bakedUrl, composition) : undefined}
          onCancel={() => setStage('review')}
        />
      )}
    </div>
  )
}
