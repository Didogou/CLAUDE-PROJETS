/**
 * Construit le prompt structuré au format Vantage attendu par LTX 2.3 +
 * IC LoRA Dual Characters (LoRA Civitai 2500098).
 *
 * Format attendu :
 *   [Scene] description du décor (placeholder pour l'instant)
 *   [Characters]
 *   Female: <description physique>  # <nom propre en commentaire>
 *   Male:   <description physique>  # <nom propre en commentaire>
 *   [Shot 1] (cadrage, durée, caméra)
 *   Female: <action>. "<dialogue>"
 *   Male:   <action>. "<dialogue>"
 *
 * ⚠ Règles dures (cf project_ltx_dual_ic_lora_prompting.md) :
 *   - Labels génériques `Male:` / `Female:` UNIQUEMENT (pas de noms propres)
 *   - Si plusieurs persos même genre : `Female 2:`, etc.
 *   - Durée injectée dans le header Shot pour aider le modèle
 *   - Actions en EN (le LoRA est entraîné EN, FR dégrade)
 *   - Pas de connecteurs `while`/`as` (non tunés) — les actions simultanées
 *     se contentent de lignes adjacentes
 *
 * Cf trigger words à éviter (`salute`, `kiss`, `handshake`…) qui font inventer
 * des persos supplémentaires — l'auteur doit les éviter dans le champ Action.
 */

import type { Character } from './character-store'
import type { AnimationPellicule, Shot } from '@/components/image-editor/EditorStateContext'

/** Termes EN injectés (pas les labels FR de l'UI). */
const SHOT_PROMPT: Record<Shot['shot'], string> = {
  wide: 'wide shot',
  medium: 'medium shot',
  close_up: 'close-up',
  extreme_close_up: 'extreme close-up',
}
const CAMERA_PROMPT: Record<Shot['camera'], string> = {
  static: 'static',
  slow_zoom_in: 'slow zoom in',
  slow_zoom_out: 'slow zoom out',
  pan_left: 'pan left',
  pan_right: 'pan right',
  dolly_in: 'dolly in',
  dolly_out: 'dolly out',
  handheld: 'handheld',
}

/** Optionnel — overrides scène à passer depuis le caller (handleGeneratePellicule)
 *  qui a fait la résolution effective + traduction FR→EN. Si fourni :
 *    - sceneVisible    → remplace le `[Scene]` placeholder
 *    - sceneOffscreen  → ajouté en suffixe à `[Scene]` (info hors-cadre)
 *    - charactersAppearance → REMPLACE entièrement le `[Characters]` (format Vantage
 *      `Female: ... / Male: ...` direct depuis Qwen VL ou auteur). Utilisé pour
 *      les cas où le perso change de tenue dans la scène vs sa fiche NPC.
 *  Tous null/undefined → fallback sur le comportement legacy (placeholder
 *  scène + descriptions Character.prompt).
 */
export interface VantagePromptOverrides {
  sceneVisible?: string | null
  sceneOffscreen?: string | null
  charactersAppearance?: string | null
  /** Position spatiale de chaque perso dans la frame source, indexée par
   *  characterId. Refonte 2026-05-10 — fix confusion d'identité LTX en
   *  donnant un ancrage spatial déterministe au LoRA Dual.
   *  Chemin A : computed depuis Designer placement.x (drag-drop) — gratuit
   *    et fiable, pas d'appel AI.
   *  Chemin B : fallback Qwen VL via charactersAppearance qui inclut déjà
   *    "standing on the left/right" dans son template (cf describe-scene
   *    route prompt). Si charactersAppearance fourni, ces positions sont
   *    ignorées (override prend priorité).
   *  Si non fourni / vide, [Characters] block construit sans suffixe spatial. */
  characterPositions?: Record<string, 'left' | 'center' | 'right'>
}

export function buildVantagePrompt(
  pell: AnimationPellicule,
  chars: Character[],
  overrides?: VantagePromptOverrides,
): string {
  const lines: string[] = []

  // ── Filtre : ne garder que les persos RÉFÉRENCÉS dans cette pellicule ─
  // Bug fix 2026-05-10 : avant, on itérait sur TOUS les persos du book,
  // résultant en labels Male/Male 2/Male 3/Male 4 même si seuls 2 persos
  // étaient en scène. Le shot block référençait alors "Male 4: Roman"
  // alors que le [Characters] block override (manuel ou Qwen VL) ne
  // définissait que Male/Male 2 → Vantage IC LoRA Dual ne pouvait pas
  // résoudre Male 4 et inventait un perso ou inversait les actions.
  // Solution : compute l'union des characterIds présents dans n'importe
  // quel shot de la pellicule, et filtre `chars` sur ces ids. Les labels
  // sont donc séquentiels SUR LES SEULS PERSOS EN SCÈNE.
  const usedIds = new Set<string>()
  for (const s of pell.shots) {
    for (const id of s.characterIds ?? []) usedIds.add(id)
  }
  // Ordre stable : on suit l'ordre d'arrivée dans le 1er shot qui les
  // mentionne (= ordre de drag-drop typiquement). Persos non listés dans
  // characterIds mais présents dans `chars` du store sont ignorés.
  const orderedIds: string[] = []
  for (const s of pell.shots) {
    for (const id of s.characterIds ?? []) {
      if (!orderedIds.includes(id) && usedIds.has(id)) orderedIds.push(id)
    }
  }
  const charsInScene = orderedIds
    .map(id => chars.find(c => c.id === id))
    .filter((c): c is Character => !!c)

  // ── Mapping perso → label Vantage ─────────────────────────────────────
  // 2 chemins :
  //
  //  1. **Override fourni** (auteur a tapé `[Characters]` à la main dans
  //     Scène > Apparence des persos, ou Qwen VL a auto-rempli avec le même
  //     format) : on PARSE chaque ligne pour extraire `# CharName` et on
  //     bind label → charId selon ce que dit l'override. Évite le bug
  //     d'inversion 2026-05-11 où l'override disait `Male = Roman` mais
  //     l'auto-builder assignait `Male = Marvyn` (ordre des vignettes shot)
  //     → Vantage recevait des labels incohérents [Characters] vs [Shot].
  //
  //  2. **Pas d'override (ou parse incomplet)** : auto-assignation séquen-
  //     tielle par bucket gender selon l'ordre `charsInScene` (= ordre des
  //     vignettes shot). Comportement historique.
  const counts = { female: 0, male: 0 }
  const labelByCharId = new Map<string, string>()

  const overrideText = overrides?.charactersAppearance?.trim()
  let overrideMappingComplete = false
  if (overrideText) {
    // Regex line-by-line : capture le label ("Male" / "Male 2" / "Female" /
    // "Female 3" / etc.) et le `# CharName` final (peut contenir des espaces
    // type "Roman 2"). Ignore les lignes sans `# Name`.
    const LINE_RE = /^\s*(Male|Female)(?:\s+(\d+))?\s*:\s*.+?\s+#\s*(.+?)\s*$/gm
    const parsed = new Map<string, string>()  // label → charName extrait
    let m: RegExpExecArray | null
    while ((m = LINE_RE.exec(overrideText)) !== null) {
      const base = m[1]
      const num = m[2]
      const label = num ? `${base} ${num}` : base
      const charName = m[3].trim()
      parsed.set(label, charName)
    }
    if (parsed.size > 0) {
      // Match par nom char avec stratégie 2-niveaux pour gérer les doublons
      // type "Roman 2" / "Marvyn" / "Marvyn 3" etc. dans la banque book.
      //
      //  1. Match exact (case-insensitive). Ex : `# Marvyn` ↔ char.name="Marvyn"
      //  2. Match par "base name" (= nom sans digits trailing). Ex :
      //     `# Roman` ↔ char.name="Roman 2" (le 2 est stripped pour matcher).
      //     Refonte 2026-05-11 — fix UX : l'auteur tape juste le nom du
      //     personnage de référence sans avoir à retenir s'il s'agit du
      //     "Roman 1" ou "Roman 2" du book.
      //
      // Le 2e niveau ne tire QUE parmi les chars NON encore mappés au 1er
      // niveau (sinon on écraserait un match exact par un fuzzy).
      const stripTrail = (n: string) => n.replace(/\s+\d+\s*$/, '').trim().toLowerCase()
      const remainingCharIds = new Set(charsInScene.map(c => c.id))
      // Niveau 1 : exact
      for (const [label, name] of parsed) {
        const matched = charsInScene.find(c =>
          remainingCharIds.has(c.id) && c.name.toLowerCase() === name.toLowerCase()
        )
        if (matched) {
          labelByCharId.set(matched.id, label)
          remainingCharIds.delete(matched.id)
        }
      }
      // Niveau 2 : base name (strip trailing digits)
      for (const [label, name] of parsed) {
        if ([...labelByCharId.values()].includes(label)) continue  // label déjà bound
        const target = stripTrail(name)
        if (!target) continue
        const matched = charsInScene.find(c =>
          remainingCharIds.has(c.id) && stripTrail(c.name) === target
        )
        if (matched) {
          labelByCharId.set(matched.id, label)
          remainingCharIds.delete(matched.id)
          console.log(
            `[buildVantagePrompt] Override match fuzzy : "# ${name}" → "${matched.name}" (label ${label})`,
          )
        }
      }
      overrideMappingComplete = labelByCharId.size === charsInScene.length
      if (!overrideMappingComplete) {
        console.warn(
          '[buildVantagePrompt] Override [Characters] partial parse — ' +
          `${labelByCharId.size}/${charsInScene.length} chars mappés. ` +
          'Fallback auto-assignation pour les non-mappés.',
        )
      }
    }
  }

  // Fallback (no override OR parse partial) : auto-assigne séquentiellement
  // les chars qui n'ont PAS encore de label, par ordre `charsInScene`.
  if (!overrideMappingComplete) {
    // Init counts depuis les labels déjà assignés via override (si parse
    // partiel — sinon counts vides). Permet à l'auto-assignation de ne pas
    // re-créer "Male" si déjà mappé via override.
    for (const label of labelByCharId.values()) {
      const baseMatch = /^(Male|Female)(?:\s+(\d+))?$/.exec(label)
      if (!baseMatch) continue
      const g = baseMatch[1] === 'Female' ? 'female' : 'male'
      const n = baseMatch[2] ? parseInt(baseMatch[2], 10) : 1
      if (n > counts[g]) counts[g] = n
    }
    for (const c of charsInScene) {
      if (labelByCharId.has(c.id)) continue  // déjà assigné via override
      const g: 'female' | 'male' = c.gender === 'male' ? 'male' : 'female'
      counts[g] += 1
      const base = g === 'female' ? 'Female' : 'Male'
      const label = counts[g] === 1 ? base : `${base} ${counts[g]}`
      labelByCharId.set(c.id, label)
    }
  }

  // ── [Scene] ───────────────────────────────────────────────────────────
  // Si l'auteur a renseigné une description (ou que Qwen VL l'a remplie auto),
  // on l'utilise. Sinon, fallback minimaliste pour ne pas casser LTX.
  const sceneVisible = overrides?.sceneVisible?.trim()
  const sceneOffscreen = overrides?.sceneOffscreen?.trim()
  if (sceneVisible) {
    let sceneLine = `[Scene] ${sceneVisible}`
    if (sceneOffscreen) {
      sceneLine += ` Off-camera: ${sceneOffscreen}`
    }
    lines.push(sceneLine)
  } else {
    // Fallback (description scène jamais renseignée — ne devrait pas arriver
    // après β.1+ car handleGeneratePellicule auto-déclenche Qwen VL si vide)
    lines.push('[Scene] Cinematic scene with characters interacting.')
  }
  lines.push('')

  // ── [Characters] ──────────────────────────────────────────────────────
  // Override prioritaire : si charactersAppearance fourni (Qwen VL ou auteur),
  // c'est lui qui décrit les persos AS THEY APPEAR IN THE SCENE (≠ fiche NPC).
  // Sinon fallback : on construit depuis les descriptions individuelles
  // Character.prompt (= fiche NPC, copiée depuis npcs.appearance).
  const charactersAppearance = overrides?.charactersAppearance?.trim()
  if (charactersAppearance) {
    lines.push('[Characters]')
    lines.push(charactersAppearance)
    lines.push('')
  } else if (charsInScene.length > 0) {
    lines.push('[Characters]')
    const positions = overrides?.characterPositions ?? {}
    for (const c of charsInScene) {
      let desc = c.prompt?.trim() || 'a person'
      // Suffixe spatial déterministe (chemin A) — uniquement si position
      // fournie pour ce perso ET que la description ne le mentionne pas
      // déjà (évite "on the left, on the right" si l'auteur a écrit la
      // position dans le prompt du perso).
      const pos = positions[c.id]
      const alreadyHasPos = /\b(on the (left|right|center)|standing (on|to the))/i.test(desc)
      if (pos && !alreadyHasPos) {
        desc += `, on the ${pos} side of the frame`
      }
      const label = labelByCharId.get(c.id) ?? c.name
      // Le `# Nom` final est ignoré par le LoRA mais lisible pour debug
      lines.push(`${label}: ${desc}  # ${c.name}`)
    }
    lines.push('')
  }

  // ── [Shot N] ──────────────────────────────────────────────────────────
  // Refacto multi-shots β.1+ 2026-05-06 : on boucle sur pell.shots[] et on
  // produit un bloc Shot par item. Pour les pellicules à 1 shot (cas simple
  // ou cas 2 conversation interactive), équivalent à l'ancien comportement.
  // Pour N shots (cas 1 conversation entre PNJ), Vantage / IC LoRA Dual sait
  // gérer les transitions et alterner les angles.
  pell.shots.forEach((shot, idx) => {
    const cameraDesc = CAMERA_PROMPT[shot.camera]
    const shotDesc = SHOT_PROMPT[shot.shot]
    // Détecte la présence d'un dialogue dans ce shot — refonte 2026-05-10 :
    // ajoute le mot "lipsync" au header si oui (insight YT Vantage : le mot
    // débloque l'animation lèvres dans les cas où LTX reste figé sur l'image
    // même avec audio fourni). Inoffensif s'il n'y a pas de dialogue, mais
    // on ne le met que quand utile pour ne pas polluer le prompt.
    const hasDialogue = charsInScene.some(c => shot.perCharacter[c.id]?.dialogue?.trim())
    const headerExtras = hasDialogue ? ', lipsync' : ''
    lines.push(`[Shot ${idx + 1}] (${shotDesc}, ${shot.duration}s, ${cameraDesc} camera${headerExtras})`)
    for (const c of charsInScene) {
      const data = shot.perCharacter[c.id]
      if (!data) continue
      // Strip ponctuation finale double (refonte 2026-05-11) — Mistral ajoute
      // souvent un "." final à son action, et le builder en rajoutait un de plus
      // → résultat `..` dans le prompt LTX. On normalise à un seul point final.
      const action = data.action.trim().replace(/[.,;:!?\s]+$/, '')
      const dialogue = data.dialogue.trim().replace(/[.,;:!?\s]+$/, '')
      if (!action && !dialogue) continue
      const label = labelByCharId.get(c.id) ?? c.name
      let line = `${label}:`
      if (action) line += ` ${action}.`
      if (dialogue) line += ` "${dialogue}"`
      lines.push(line)
    }
    // Refonte 2026-05-13 : injection de sceneAction pour pellicule sans perso
    // (= animation pure type plan aérien, travelling sur décor). On le pousse
    // en ligne narrative claire sans label perso (LTX I2V comprend le langage
    // naturel). Format : "Camera: <description>" pour rester cohérent avec
    // le format Vantage tout en signalant que c'est un mouvement de scène.
    const sceneAction = (shot.sceneAction ?? '').trim().replace(/[.,;:!?\s]+$/, '')
    if (sceneAction) {
      lines.push(`Camera: ${sceneAction}.`)
    }
    // Saut de ligne entre shots pour lisibilité (pas après le dernier)
    if (idx < pell.shots.length - 1) lines.push('')
  })

  return lines.join('\n')
}
