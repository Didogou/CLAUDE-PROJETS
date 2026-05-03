'use client'
/**
 * POC Flux Kontext — édition par instruction (single + multi-image).
 *
 * Modes :
 *   - Single image : édite l'image seule via instruction (color, pose, remove…)
 *   - Multi-image  : combine 2 images (scène + perso ref) → instructions du
 *                    type "place the character from the second image sitting
 *                    on the bench in the first image"
 *
 * VRAM : ~10 GB nécessaires sur 8 GB → NVIDIA Sysmem Fallback obligatoire.
 * Performance : 3-7 min/run single, 5-10 min multi.
 */

import React, { useCallback, useState } from 'react'

interface Run {
  id: string
  prompt: string
  sourceUrl: string
  refUrl?: string
  status: 'uploading' | 'queuing' | 'generating' | 'fetching' | 'done' | 'error'
  promptId?: string
  resultUrl?: string
  error?: string
  startedAt: number
  finishedAt?: number
  guidance: number
  steps: number
  testCaseId?: string
}

/** Presets d'instructions single-image. */
const SINGLE_PRESETS: Array<{ id: string; label: string; prompt: string }> = [
  { id: 'remove_obj',    label: '🗑 Enlever objet',      prompt: 'remove the necklace' },
  { id: 'change_color',  label: '🎨 Changer couleur',    prompt: 'change the color of the dress to deep blue' },
  { id: 'add_obj',       label: '➕ Ajouter accessoire', prompt: 'add round wire-frame glasses to the character' },
  { id: 'change_bg',     label: '🌅 Changer décor',     prompt: 'replace the background with a sunset beach scene' },
  { id: 'change_style',  label: '🖌 Style aquarelle',    prompt: 'transform into watercolor illustration style' },
  { id: 'change_pose',   label: '🪑 S\'asseoir',         prompt: 'the character is now sitting on a wooden chair, hands resting on lap' },
  { id: 'change_outfit', label: '👗 Changer tenue',      prompt: 'change the outfit to medieval knight armor' },
]

/** Cas de test multi-image : scène + perso à insérer + instruction Kontext.
 *  Chaque cas génère scène + perso, puis fait Kontext multi-image avec instruction. */
const KONTEXT_MULTI_TEST_CASES: Array<{
  id: string
  label: string
  scene_prompt: string
  character_prompt: string
  edit_instruction: string
}> = [
  {
    id: 'tavern_bench_sitting_elf',
    label: '🍺 Elfe assise sur banc de taverne',
    scene_prompt: 'medieval tavern interior, wooden tables and benches, candlelight, hanging lanterns, stone walls, barrels, an empty long wooden bench in the foreground center, painterly fantasy illustration, warm lighting, detailed background, high quality',
    character_prompt: 'young elf woman, long flowing blonde hair, blue eyes, fair skin, pointed ears, simple medieval green dress with white sleeves, white background, character reference sheet, painterly fantasy illustration',
    edit_instruction: 'place the character from the second image sitting on the wooden bench in the first image, hands resting on knees, painterly fantasy style, warm candlelight on the character',
  },
  {
    id: 'forge_warrior_at_fire',
    label: '🔨 Guerrière debout devant le feu de forge',
    scene_prompt: 'medieval blacksmith forge interior, anvil in foreground, glowing fire pit on the left, hanging tools, stone walls, painterly fantasy illustration, warm fire glow, detailed background, high quality',
    character_prompt: 'female warrior, short brown hair, athletic build, leather armor with metal pauldrons, sword on back, white background, character reference sheet, painterly fantasy illustration',
    edit_instruction: 'place the character from the second image standing next to the glowing fire in the first image, looking at the camera, warm orange firelight on the character, painterly fantasy style',
  },
  {
    id: 'library_wizard_reading',
    label: '📚 Mage lisant à un bureau',
    scene_prompt: 'large medieval library interior, towering bookshelves, candlelight, dust motes, an empty wooden writing desk with an open book in the center foreground, painterly fantasy illustration, atmospheric, detailed background',
    character_prompt: 'old wizard, long white beard, blue robe with silver stars, kind blue eyes, white background, character reference sheet, painterly fantasy illustration',
    edit_instruction: 'place the character from the second image sitting at the wooden desk in the first image, reading the open book, holding a quill, painterly fantasy style, candlelight on the character',
  },
  {
    id: 'forest_traveler_walking',
    label: '🌲 Voyageur marchant sur le chemin',
    scene_prompt: 'forest clearing in the morning, ancient mossy stones, sunlight through tall trees, an empty stone path leading away into the woods, painterly fantasy illustration, atmospheric, detailed background',
    character_prompt: 'young man traveler, brown leather jacket, wooden walking staff, leather backpack, weathered face, white background, character reference sheet, painterly fantasy illustration',
    edit_instruction: 'place the character from the second image walking on the stone path in the first image, facing the camera, full body visible, painterly fantasy style, atmospheric morning light',
  },
  {
    id: 'market_princess_at_stall',
    label: '🏪 Princesse derrière étal de marché',
    scene_prompt: 'medieval market square at midday, an empty wooden stall with goods displayed in the foreground center, stone fountain in background, painterly fantasy illustration, sunny, detailed background',
    character_prompt: 'young princess, elaborate braided blonde hair, golden tiara, pale blue silk dress, gentle expression, white background, character reference sheet, painterly fantasy illustration',
    edit_instruction: 'place the character from the second image standing behind the wooden stall in the first image, looking at the camera with a slight smile, painterly fantasy style, sunny midday lighting',
  },
  {
    id: 'castle_knight_stairs',
    label: '🏰 Chevalier descendant un escalier',
    scene_prompt: 'medieval castle interior with grand stone staircase descending from the upper level, torches on the walls, ornate tapestries, empty staircase, painterly fantasy illustration, dramatic lighting, detailed background',
    character_prompt: 'noble knight in shining silver plate armor, royal blue cape, helmet under arm, short brown hair, white background, character reference sheet, painterly fantasy illustration',
    edit_instruction: 'place the character from the second image walking down the stone staircase in the first image, mid-step, facing camera, painterly fantasy style, torch light glinting on armor',
  },
  {
    id: 'campfire_orc_sitting',
    label: '🔥 Orc assis près d\'un feu de camp',
    scene_prompt: 'forest clearing at night, a cozy campfire crackling in the center foreground, surrounded by mossy logs, moonlight filtering through trees, painterly fantasy illustration, warm fire glow vs cool moonlight, detailed background',
    character_prompt: 'fierce orc warrior, green skin, large tusks, scarred face, animal-bone armor, muscular build, white background, character reference sheet, painterly fantasy illustration',
    edit_instruction: 'place the character from the second image sitting on a log next to the campfire in the first image, hands warming over the flames, painterly fantasy style, warm orange firelight on the character',
  },
  {
    id: 'cave_child_exploring',
    label: '⛰ Enfant explorant une grotte',
    scene_prompt: 'mysterious crystal cave interior, glowing blue crystals embedded in walls, an empty rocky path winding through the cavern, painterly fantasy illustration, magical blue glow, detailed background',
    character_prompt: 'young child age 8, curly red hair, freckles, simple worn brown clothes, holding a small lantern, white background, character reference sheet, painterly illustration',
    edit_instruction: 'place the character from the second image standing on the rocky path in the first image, holding the lantern up, looking around with wonder, painterly fantasy style, magical blue crystal glow on the character',
  },
]

export default function FluxKontextPage() {
  // Mode
  const [mode, setMode] = useState<'single' | 'multi'>('multi')

  // Image 1 (source / scène)
  const [sourceUrl, setSourceUrl] = useState('')
  const [uploadingSource, setUploadingSource] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)

  // Image 2 (référence perso, optionnelle = mode multi)
  const [refUrl, setRefUrl] = useState('')
  const [uploadingRef, setUploadingRef] = useState(false)
  const [refError, setRefError] = useState<string | null>(null)

  // Pivot ref via qwen_multiangle (Qwen Image Edit + multi-angles LoRA)
  const [rotatingRef, setRotatingRef] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)
  const [originalRefUrl, setOriginalRefUrl] = useState('')  // garde la ref originale pour revert

  // Instruction + params
  const [prompt, setPrompt] = useState(KONTEXT_MULTI_TEST_CASES[0].edit_instruction)
  const [guidance, setGuidance] = useState(2.5)
  const [steps, setSteps] = useState(20)

  // Test case auto-pipeline
  const [selectedTest, setSelectedTest] = useState<string>('')
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoStep, setAutoStep] = useState<string>('')

  const [runs, setRuns] = useState<Run[]>([])

  async function handleUpload(slot: 'source' | 'ref', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (slot === 'source') { setUploadingSource(true); setSourceError(null); setSourceUrl('') }
    else { setUploadingRef(true); setRefError(null); setRefUrl('') }
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('path', `test/flux-kontext/${slot}_${Date.now()}`)
      const res = await fetch('/api/upload-image', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'upload failed')
      if (slot === 'source') setSourceUrl(data.url)
      else { setRefUrl(data.url); setOriginalRefUrl(data.url) }  // mémorise l'original pour revert pivot
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (slot === 'source') setSourceError(msg); else setRefError(msg)
    } finally {
      if (slot === 'source') setUploadingSource(false); else setUploadingRef(false)
    }
  }

  /** Pivote la ref perso via qwen_multiangle.
   *  Lance Qwen Image Edit + LoRA multi-angles avec un prompt d'angle.
   *  Le résultat remplace refUrl (l'original est conservé dans originalRefUrl). */
  async function handleRotateRef(angle: string, prompt: string) {
    if (!refUrl) return
    setRotatingRef(true)
    setRotateError(null)
    try {
      // Double free + cooldown long : Qwen Image Edit (~10 GB) sur 8 GB VRAM
      // exige que TOUT soit déchargé avant. ComfyUI /free marque les modèles
      // pour unload mais le GC PyTorch peut être lent. 2 appels + wait 5s.
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 2500))
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 2500))

      // Upload current ref vers ComfyUI input
      const upRes = await fetch('/api/comfyui/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: refUrl, name: 'qmultiangle_src' }),
      }).then(r => r.json())
      if (!upRes.filename) throw new Error(upRes.error ?? 'upload ref failed')

      // Re-free juste avant le queue (au cas où l'upload a réservé du buffer)
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 2000))

      const queueRes = await fetch('/api/comfyui', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'qwen_multiangle',
          source_image: upRes.filename,
          prompt_positive: prompt,
          prompt_negative: 'blurry, low quality, deformed, distorted',
          steps: 4, cfg: 1, seed: -1,
        }),
      }).then(r => r.json())
      if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'queue failed')

      // Poll — Qwen Image Edit + Lightning LoRA = rapide (~30-60s)
      const maxWait = Date.now() + 5 * 60 * 1000
      let succeeded = false
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 3000))
        const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'rotation failed')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('rotation timeout (5 min)')

      const storagePath = `test/flux-kontext/rotated_${angle}_${Date.now()}`
      const iData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`).then(r => r.json())
      if (!iData.image_url) throw new Error(iData.error ?? 'image_url manquante')
      setRefUrl(iData.image_url)  // remplace la ref par la version pivotée

      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 2000))
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : String(err))
    } finally {
      setRotatingRef(false)
    }
  }

  /** Restaure la ref originale (annule le pivot). */
  function handleRevertRef() {
    if (originalRefUrl) setRefUrl(originalRefUrl)
    setRotateError(null)
  }

  /** Génère une image via T2I SDXL Juggernaut (réutilisé pour les test cases). */
  async function generateT2I(promptText: string, w: number, h: number, prefix: string): Promise<string> {
    await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    await new Promise(r => setTimeout(r, 1500))
    const queueRes = await fetch('/api/comfyui', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_type: 'portrait',
        prompt_positive: promptText,
        prompt_negative: 'blurry, low quality, deformed, distorted, watermark, text',
        width: w, height: h, steps: 30, cfg: 7, seed: -1,
      }),
    }).then(r => r.json())
    if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'T2I queue failed')

    const maxWait = Date.now() + 5 * 60 * 1000
    let succeeded = false
    while (Date.now() < maxWait) {
      await new Promise(r => setTimeout(r, 3000))
      const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
      if (sData.error) throw new Error(sData.error)
      if (sData.status === 'failed') throw new Error(sData.error ?? 'T2I failed')
      if (sData.status === 'succeeded') { succeeded = true; break }
    }
    if (!succeeded) throw new Error('T2I timeout (5 min)')

    const storagePath = `test/flux-kontext/${prefix}_${Date.now()}`
    const iData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`).then(r => r.json())
    if (!iData.image_url) throw new Error(iData.error ?? 'T2I image_url manquante')

    await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    await new Promise(r => setTimeout(r, 2000))
    return iData.image_url as string
  }

  const handleGenerate = useCallback(async (overrides?: { srcUrl?: string; refImgUrl?: string; promptText?: string; testCaseId?: string }) => {
    const _src = overrides?.srcUrl ?? sourceUrl
    const _ref = overrides?.refImgUrl ?? refUrl
    const _prompt = overrides?.promptText ?? prompt
    if (!_src || !_prompt.trim()) return

    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
    const newRun: Run = {
      id, prompt: _prompt, sourceUrl: _src,
      refUrl: mode === 'multi' && _ref ? _ref : undefined,
      guidance, steps,
      status: 'uploading', startedAt: Date.now(),
      testCaseId: overrides?.testCaseId,
    }
    setRuns(prev => [newRun, ...prev])

    try {
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))

      const upSrc = await fetch('/api/comfyui/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url', url: _src, name: 'kontext_src' }),
      }).then(r => r.json())
      if (!upSrc.filename) throw new Error(upSrc.error ?? 'upload source failed')

      let upRef: { filename?: string } | undefined
      if (mode === 'multi' && _ref) {
        upRef = await fetch('/api/comfyui/upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'url', url: _ref, name: 'kontext_ref' }),
        }).then(r => r.json())
        if (!upRef?.filename) throw new Error('upload ref failed')
      }

      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'queuing' } : r))
      const queueRes = await fetch('/api/comfyui', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_type: 'flux_kontext',
          source_image: upSrc.filename,
          ...(upRef?.filename ? { reference_image: upRef.filename } : {}),
          prompt_positive: _prompt,
          prompt_negative: '',
          cfg: guidance, steps, seed: -1,
        }),
      }).then(r => r.json())
      if (!queueRes.prompt_id) throw new Error(queueRes.error ?? 'queue failed')
      setRuns(prev => prev.map(r => r.id === id ? { ...r, promptId: queueRes.prompt_id, status: 'generating' } : r))

      const maxWait = Date.now() + 12 * 60 * 1000
      let succeeded = false
      while (Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 4000))
        const sData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}`).then(r => r.json())
        if (sData.error) throw new Error(sData.error)
        if (sData.status === 'failed') throw new Error(sData.error ?? 'generation failed')
        if (sData.status === 'succeeded') { succeeded = true; break }
      }
      if (!succeeded) throw new Error('timeout (12 min) — sysmem fallback peut-être désactivé')

      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'fetching' } : r))
      const storagePath = `test/flux-kontext/result_${id}`
      const iData = await fetch(`/api/comfyui?prompt_id=${queueRes.prompt_id}&action=image&storage_path=${encodeURIComponent(storagePath)}`).then(r => r.json())
      if (!iData.image_url) throw new Error(iData.error ?? 'image_url manquante')
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'done', resultUrl: iData.image_url, finishedAt: Date.now() } : r))

      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
      await new Promise(r => setTimeout(r, 3000))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRuns(prev => prev.map(r => r.id === id ? { ...r, status: 'error', error: msg, finishedAt: Date.now() } : r))
      await fetch('/api/comfyui/free', { method: 'POST' }).catch(() => {})
    }
  }, [sourceUrl, refUrl, prompt, mode, guidance, steps])

  /** Sélectionne un test case → remplit prompt (l'utilisateur peut éditer / générer scène et perso). */
  function handleSelectTest(id: string) {
    setSelectedTest(id)
    if (!id) return
    const t = KONTEXT_MULTI_TEST_CASES.find(x => x.id === id)
    if (!t) return
    setMode('multi')
    setPrompt(t.edit_instruction)
  }

  /** Auto-pipeline test case complet : génère scène + perso + Kontext multi. */
  async function handleRunTestAuto() {
    if (!selectedTest) return
    const t = KONTEXT_MULTI_TEST_CASES.find(x => x.id === selectedTest)
    if (!t) return
    setAutoRunning(true)
    setAutoStep('')
    try {
      setAutoStep('1/3 · Génération scène (~60-90s)…')
      const sceneUrl = await generateT2I(t.scene_prompt, 1360, 768, 'scene')
      setSourceUrl(sceneUrl)

      setAutoStep('2/3 · Génération perso (~60-90s)…')
      const charUrl = await generateT2I(t.character_prompt, 1024, 1024, 'character')
      setRefUrl(charUrl)

      setAutoStep('3/3 · Flux Kontext multi-image (3-10 min sur 8 GB)…')
      await handleGenerate({ srcUrl: sceneUrl, refImgUrl: charUrl, promptText: t.edit_instruction, testCaseId: t.id })

      setAutoStep('✅ Terminé')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setAutoStep(`❌ ${msg}`)
    } finally {
      setAutoRunning(false)
    }
  }

  const isAnyRunning = runs.some(r => r.status !== 'done' && r.status !== 'error')
  const ready = sourceUrl && prompt.trim() && (mode === 'single' || refUrl)

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1500, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC Flux Kontext — édition par instruction (single + multi-image)
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          Single : édite une image (color, pose, style…). Multi : combine 2 images pour insérer un perso dans une scène avec pose contrôlée par texte.
          <br />
          ⚠️ <strong>3-10 min/run sur 8 GB VRAM</strong> (sysmem fallback NVIDIA actif).
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '460px 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Mode toggle */}
            <Section title="Mode">
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => setMode('single')}
                  disabled={isAnyRunning || autoRunning}
                  style={{
                    ...btnStyle, flex: 1, padding: 8,
                    background: mode === 'single' ? '#A855F7' : '#1a1a1e',
                    fontWeight: mode === 'single' ? 700 : 400,
                  }}>
                  📝 Single image
                </button>
                <button onClick={() => setMode('multi')}
                  disabled={isAnyRunning || autoRunning}
                  style={{
                    ...btnStyle, flex: 1, padding: 8,
                    background: mode === 'multi' ? '#A855F7' : '#1a1a1e',
                    fontWeight: mode === 'multi' ? 700 : 400,
                  }}>
                  🖼+🖼 Multi (2 images)
                </button>
              </div>
              <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                {mode === 'single'
                  ? '1 image + instruction → édit (color, pose, remove, etc.)'
                  : '2 images (scène + perso) + instruction → insertion du perso dans la scène'}
              </div>
            </Section>

            {/* Test cases multi-image */}
            {mode === 'multi' && (
              <Section title="🧪 Cas de test (génère tout auto)">
                <Field label="Sélectionne un cas">
                  <select value={selectedTest}
                    onChange={e => handleSelectTest(e.target.value)}
                    disabled={isAnyRunning || autoRunning}
                    style={{ ...inputStyle, padding: 6 }}>
                    <option value="">— Choisir un cas —</option>
                    {KONTEXT_MULTI_TEST_CASES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </Field>
                <button onClick={handleRunTestAuto}
                  disabled={!selectedTest || autoRunning || isAnyRunning}
                  style={{
                    ...btnStyle, width: '100%', padding: 10,
                    background: !selectedTest ? '#444' : autoRunning ? '#7C3AED' : '#DC2626',
                    color: 'white', fontSize: 13, fontWeight: 700,
                  }}>
                  {autoRunning ? '⏳ Pipeline en cours…' : '🚀 Tout automatique (3 étapes, ~5-12 min)'}
                </button>
                {autoStep && (
                  <div style={{ padding: 6, background: autoStep.startsWith('❌') ? '#7f1d1d' : autoStep.startsWith('✅') ? '#065f46' : '#1e3a8a', borderRadius: 4, fontSize: 11, color: '#fff' }}>
                    {autoStep}
                  </div>
                )}
                <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                  Sélectionner un cas remplit l&apos;instruction. <strong>🚀 Tout automatique</strong> enchaîne : scène SDXL → perso SDXL → Flux Kontext multi.
                </div>
              </Section>
            )}

            <Section title={mode === 'single' ? '① Image source' : '① Image scène (1ère image)'}>
              <input type="file" accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpload('source', e)}
                disabled={uploadingSource || isAnyRunning || autoRunning}
                style={{ ...inputStyle, padding: 6 }} />
              {uploadingSource && <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Upload…</div>}
              {sourceUrl && <div style={{
                marginTop: 6,
                background: `url(${sourceUrl}) center/contain no-repeat #1a1a1e`,
                height: 150, border: '1px solid #2a2a30', borderRadius: 4,
              }} />}
              {sourceError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {sourceError}</div>}
            </Section>

            {mode === 'multi' && (
              <Section title="② Image perso à insérer (2ème image)">
                <input type="file" accept="image/png,image/jpeg,image/webp"
                  onChange={e => handleUpload('ref', e)}
                  disabled={uploadingRef || isAnyRunning || autoRunning}
                  style={{ ...inputStyle, padding: 6 }} />
                {uploadingRef && <div style={{ fontSize: 11, color: '#9898b4' }}>⏳ Upload…</div>}
                {refUrl && <div style={{
                  marginTop: 6,
                  background: `url(${refUrl}) center/contain no-repeat #1a1a1e`,
                  height: 150, border: '1px solid #2a2a30', borderRadius: 4,
                }} />}
                {refError && <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {refError}</div>}
                <div style={{ fontSize: 9, color: '#666' }}>
                  Idéalement : perso fond blanc, full body visible, pose neutre.
                </div>

                {/* ── Pivot ref via qwen_multiangle ── */}
                {refUrl && (
                  <div style={{ marginTop: 8, padding: 8, background: '#0a0a0d', border: '1px solid #2a2a30', borderRadius: 4 }}>
                    <div style={{ fontSize: 10, color: '#10B981', fontWeight: 600, marginBottom: 6 }}>
                      🔄 Pivoter le perso (Qwen Image Edit + multi-angles LoRA)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 6 }}>
                      <button onClick={() => handleRotateRef('front', 'view from the front, character facing the camera')}
                        disabled={rotatingRef || isAnyRunning || autoRunning}
                        style={{ ...btnStyle, fontSize: 10, padding: '6px 4px', background: '#1a1a1e' }}>
                        Face
                      </button>
                      <button onClick={() => handleRotateRef('3q-left', 'three-quarter view from the left side of the character')}
                        disabled={rotatingRef || isAnyRunning || autoRunning}
                        style={{ ...btnStyle, fontSize: 10, padding: '6px 4px', background: '#1a1a1e' }}>
                        ¾ Gauche
                      </button>
                      <button onClick={() => handleRotateRef('3q-right', 'three-quarter view from the right side of the character')}
                        disabled={rotatingRef || isAnyRunning || autoRunning}
                        style={{ ...btnStyle, fontSize: 10, padding: '6px 4px', background: '#1a1a1e' }}>
                        ¾ Droite
                      </button>
                      <button onClick={() => handleRotateRef('profile-left', 'side profile view from the left, character facing left')}
                        disabled={rotatingRef || isAnyRunning || autoRunning}
                        style={{ ...btnStyle, fontSize: 10, padding: '6px 4px', background: '#1a1a1e' }}>
                        Profil G
                      </button>
                      <button onClick={() => handleRotateRef('profile-right', 'side profile view from the right, character facing right')}
                        disabled={rotatingRef || isAnyRunning || autoRunning}
                        style={{ ...btnStyle, fontSize: 10, padding: '6px 4px', background: '#1a1a1e' }}>
                        Profil D
                      </button>
                      <button onClick={() => handleRotateRef('back', 'back view, character facing away from the camera')}
                        disabled={rotatingRef || isAnyRunning || autoRunning}
                        style={{ ...btnStyle, fontSize: 10, padding: '6px 4px', background: '#1a1a1e' }}>
                        Dos
                      </button>
                    </div>
                    {rotatingRef && <div style={{ fontSize: 10, color: '#9898b4' }}>⏳ Pivotement (~30-60s)…</div>}
                    {rotateError && <div style={{ padding: 4, background: '#7f1d1d', borderRadius: 3, fontSize: 10, color: '#fff' }}>❌ {rotateError}</div>}
                    {originalRefUrl && originalRefUrl !== refUrl && (
                      <button onClick={handleRevertRef}
                        disabled={rotatingRef}
                        style={{ ...btnStyle, width: '100%', fontSize: 10, padding: 4, background: '#374151', color: '#fff' }}>
                        ↶ Revenir à la ref originale
                      </button>
                    )}
                    <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                      Pivote le perso AVANT de l&apos;insérer dans la scène. Plus fiable que demander à Flux Kontext de tourner via le prompt.
                    </div>
                  </div>
                )}
              </Section>
            )}

            <Section title={mode === 'single' ? '② Instruction' : '③ Instruction (référence "first/second image")'}>
              {mode === 'single' && (
                <Field label="Presets">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {SINGLE_PRESETS.map(p => (
                      <button key={p.id}
                        onClick={() => setPrompt(p.prompt)}
                        disabled={isAnyRunning}
                        style={{ ...btnStyle, fontSize: 10, padding: '4px 8px', background: '#1a1a1e' }}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </Field>
              )}
              <Field label="Instruction (anglais recommandé)">
                <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                  rows={4} disabled={isAnyRunning || autoRunning}
                  placeholder={mode === 'single'
                    ? 'ex: change the color of the dress to deep blue'
                    : 'ex: place the character from the second image sitting on the bench in the first image'}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
              </Field>
              <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                {mode === 'single' ? (
                  <>✅ remove X · change color of X · add Y · replace background · change style · sit/stand</>
                ) : (
                  <>
                    🔑 <strong>Référence explicite</strong> aux 2 images : "in the first image", "from the second image", "the character from the second image". Sinon Flux ne sait pas lequel est lequel.
                  </>
                )}
              </div>
            </Section>

            <Section title={mode === 'single' ? '③ Paramètres' : '④ Paramètres'}>
              <Field label={`FluxGuidance : ${guidance.toFixed(1)}`}>
                <input type="range" min={1.5} max={5} step={0.1} value={guidance}
                  onChange={e => setGuidance(Number(e.target.value))}
                  disabled={isAnyRunning || autoRunning} style={{ width: '100%' }} />
                <div style={{ fontSize: 9, color: '#666' }}>⭐ <strong>2.5</strong> = officiel BFL. &gt;4 = over-edit.</div>
              </Field>
              <Field label={`Steps : ${steps}`}>
                <input type="range" min={10} max={40} step={1} value={steps}
                  onChange={e => setSteps(Number(e.target.value))}
                  disabled={isAnyRunning || autoRunning} style={{ width: '100%' }} />
              </Field>
            </Section>

            <button onClick={() => handleGenerate()}
              disabled={!ready || isAnyRunning || autoRunning}
              style={{
                ...btnStyle,
                background: (!ready || isAnyRunning || autoRunning) ? '#444' : '#A855F7',
                color: 'white', padding: 12, fontSize: 14, fontWeight: 700,
              }}>
              {isAnyRunning ? '⏳ Édition en cours…'
                : !sourceUrl ? '⚠ Upload une image source'
                : (mode === 'multi' && !refUrl) ? '⚠ Upload aussi le perso (mode multi)'
                : !prompt.trim() ? '⚠ Tape une instruction'
                : `🪄 Lancer Flux Kontext ${mode === 'multi' ? 'multi-image' : 'single'}`}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#A855F7', textTransform: 'uppercase' }}>
              Historique ({runs.length})
            </div>
            {runs.length === 0 && (
              <div style={{ padding: 24, background: '#0f0f13', border: '1px dashed #2a2a30',
                borderRadius: 6, fontSize: 12, color: '#666', textAlign: 'center' }}>
                Choisis un cas de test ou upload tes propres images.
              </div>
            )}
            {runs.map(r => <RunCard key={r.id} run={r} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

function RunCard({ run }: { run: Run }) {
  const elapsed = Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)
  return (
    <div style={{ padding: 10, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
        <span style={{ color: '#ede9df', fontWeight: 600, fontStyle: 'italic' }}>
          {run.refUrl ? '🖼+🖼 ' : '📝 '}&ldquo;{run.prompt.slice(0, 80)}…&rdquo;
        </span>
        <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
          background: run.status === 'done' ? '#10B981' : run.status === 'error' ? '#7f1d1d' : '#A855F7', color: '#fff' }}>
          {run.status} · {elapsed}s
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4, fontSize: 9, color: '#9898b4' }}>
        <code style={{ background: '#1a1a1e', padding: '2px 5px', borderRadius: 3 }}>guidance {run.guidance.toFixed(1)}</code>
        <code style={{ background: '#1a1a1e', padding: '2px 5px', borderRadius: 3 }}>{run.steps}st</code>
        {run.testCaseId && <code style={{ background: '#7C3AED', padding: '2px 5px', borderRadius: 3, color: '#fff' }}>{run.testCaseId}</code>}
      </div>
      {/* Inputs (1 ou 2) */}
      <div style={{ display: 'grid', gridTemplateColumns: run.refUrl ? '1fr 1fr' : '1fr', gap: 6 }}>
        <div>
          <div style={{ fontSize: 9, color: '#666', textAlign: 'center', marginBottom: 2 }}>{run.refUrl ? 'SCÈNE (1)' : 'SOURCE'}</div>
          <img src={run.sourceUrl} alt="src" style={{ width: '100%', borderRadius: 3, background: '#000' }} />
        </div>
        {run.refUrl && (
          <div>
            <div style={{ fontSize: 9, color: '#A855F7', textAlign: 'center', marginBottom: 2, fontWeight: 600 }}>PERSO (2) →</div>
            <img src={run.refUrl} alt="ref" style={{ width: '100%', borderRadius: 3, background: '#000', border: '2px solid #A855F7' }} />
          </div>
        )}
      </div>
      {/* Result */}
      {run.status === 'done' && run.resultUrl && (
        <>
          <div style={{ fontSize: 9, color: '#10B981', textAlign: 'center', fontWeight: 600 }}>RÉSULTAT ↓</div>
          <img src={run.resultUrl} alt="result" style={{ width: '100%', borderRadius: 4, background: '#000', border: '2px solid #10B981' }} />
        </>
      )}
      {run.status === 'error' && (
        <div style={{ padding: 6, background: '#7f1d1d', borderRadius: 4, fontSize: 11 }}>❌ {run.error}</div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#A855F7', textTransform: 'uppercase' }}>{title}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ fontSize: 11, color: '#9898b4' }}>{label}</label>
      {children}
    </div>
  )
}

const pageStyle: React.CSSProperties = { minHeight: '100vh', padding: '2rem', background: '#0d0d0d', color: '#ede9df', fontFamily: 'Inter, -apple-system, sans-serif' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', background: '#1a1a1e', border: '1px solid #2a2a30', borderRadius: 4, color: '#ede9df', fontSize: 12 }
const btnStyle: React.CSSProperties = { padding: '8px 12px', background: '#1a1a1e', border: '1px solid #2a2a30', borderRadius: 4, color: '#ede9df', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }
