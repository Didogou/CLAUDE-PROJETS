import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BOOK_ID = 'e73923c7-a1c9-480e-8267-d69c5ca885b8'

// NPCs alliés permanents (ne jamais supprimer)
const ALLIES = ['travis', 'shawn', 'zac', 'james', 'jesse', 'adam', 'faye']

const TRIAL_TYPES = ['combat', 'agilite', 'intelligence', 'magie', 'chance', 'crochetage', 'dialogue']

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const data = JSON.parse(readFileSync('d:/Projets/Claude-projets/hero/freaks_tome1_sections.json', 'utf-8'))

// ── Mapping lieu → location_id ────────────────────────────────────────────────
const LOCATION_MAP = {
  'de3b26ea-4884-41fa-8bd7-8876119756e8': ['van cortlandt park', 'centre de la foule', 'lisière des arbres', 'entre les arbres', 'nuit'],
  'a8368507-a8d6-4e6e-bc19-564a2955fc62': ['clochards', 'van cortlandt lake', 'bois'],
  '336718fb-3185-4bde-a034-ba3f4aced853': ['lisière est'],
  '34a983c4-69d3-49e3-8564-15511f36c6e2': ['jerome avenue', 'west 238th', 'west 235th', 'west 231st', 'piliers'],
  'f371404a-cd3c-4bf9-b0ff-cac9dcdf70d4': ['garages'],
  '632062f6-49c1-40ad-9312-930e50cffab2': ['sedgwick', 'bailey', 'cour intérieure', 'bodega'],
  '5907f037-f7af-477d-b11f-656ce0262387': ['bodega'],
  'b53a3adf-2136-4cef-b75b-773b3241534d': ['riverdale', 'sommet', 'montée boisée', 'descente vers les berges'],
  '2230b3de-a8e0-4e55-beff-24290c79de1d': ['fort independence'],
  'f460a033-1f9e-460d-9850-0200a30e3442': ['kingsbridge armory', 'kingsbridge road', 'mclellan', 'mcclellan'],
  'c933d08e-bade-4254-9277-9c8d85cc5073': ['station-service'],
  'eb5a9560-a608-4cf5-83d9-e0295318d4ef': ['harlem river', 'berges'],
}

function resolveLocation(lieu) {
  if (!lieu) return null
  const l = lieu.toLowerCase()
  for (const [id, keywords] of Object.entries(LOCATION_MAP)) {
    if (keywords.some(k => l.includes(k))) return id
  }
  return null
}

// ── Mapping type → trial ──────────────────────────────────────────────────────
function buildTrial(section, idMap) {
  if (!TRIAL_TYPES.includes(section.type)) return null

  const stat = section.type === 'combat' ? 'force'
    : section.type === 'dialogue' ? 'intelligence'
    : section.type

  const successChoix = section.choix?.find(c =>
    c.label.toLowerCase().includes('succès') || c.label.toLowerCase().includes('success')
  )
  const echecChoix = section.choix?.find(c =>
    c.label.toLowerCase().includes('échec') || c.label.toLowerCase().includes('fin —')
  )

  const trial = { type: section.type, stat }

  if (successChoix?.cible && successChoix.cible !== 'FIN-MORT' && !successChoix.cible.startsWith('CHEMIN-')) {
    trial.success_section_id = idMap.get(successChoix.cible) ?? null
  }
  if (echecChoix?.cible && echecChoix.cible !== 'FIN-MORT' && !echecChoix.cible.startsWith('CHEMIN-')) {
    trial.failure_section_id = idMap.get(echecChoix.cible) ?? null
  }

  const echecMalus = echecChoix?.malus
  if (echecMalus && typeof echecMalus === 'string' && echecMalus.includes('endurance')) {
    const match = echecMalus.match(/-(\d+)/)
    if (match) trial.endurance_loss_on_failure = parseInt(match[1])
  }

  return trial
}

// ── Choix trial vs navigation ─────────────────────────────────────────────────
function isTrialChoice(label) {
  const l = label.toLowerCase()
  return l.startsWith('succès') || l.startsWith('échec') || l.startsWith('fin —') || l.startsWith('→')
}

// ── Résoudre les companion_npc_ids depuis le champ npcs[] d'une section ───────
function resolveCompanions(sectionNpcs, npcNameMap) {
  if (!sectionNpcs?.length) return []
  const ids = []
  for (const rawName of sectionNpcs) {
    const name = rawName.toLowerCase()
      .replace(' isolé', '').replace(' (groupe)', '').replace(' (voiture)', '')
      .replace(' (nouvelle)', '').replace(' (au podium)', '').trim()
    const id = npcNameMap.get(name)
    if (id) ids.push(id)
  }
  return [...new Set(ids)]
}

async function main() {
  console.log('=== IMPORT FREAKS TOME 1 — V3 ===\n')

  // 1. Supprimer sections existantes
  console.log('1. Suppression des sections existantes...')
  const { data: existingSections } = await supabase.from('sections').select('id').eq('book_id', BOOK_ID)
  if (existingSections?.length) {
    const ids = existingSections.map(s => s.id)
    await supabase.from('choices').delete().in('section_id', ids)
    await supabase.from('choices').delete().in('target_section_id', ids)
    await supabase.from('sections').delete().eq('book_id', BOOK_ID)
    console.log(`   ${ids.length} sections supprimées`)
  } else {
    console.log('   Aucune section existante')
  }

  // 2. Supprimer items existants
  console.log('2. Suppression des items existants...')
  await supabase.from('items').delete().eq('book_id', BOOK_ID)
  console.log('   Items supprimés')

  // 3. Supprimer NPCs ennemis (conserver les alliés + Faye)
  console.log('3. Suppression des NPCs ennemis...')
  const { data: existingNpcs } = await supabase.from('npcs').select('id, name').eq('book_id', BOOK_ID)
  const ennemisIds = (existingNpcs ?? [])
    .filter(n => !ALLIES.includes(n.name.toLowerCase()))
    .map(n => n.id)
  if (ennemisIds.length) {
    await supabase.from('npcs').delete().in('id', ennemisIds)
    console.log(`   ${ennemisIds.length} NPCs ennemis supprimés`)
  } else {
    console.log('   Aucun NPC ennemi existant')
  }

  // 4. Créer Faye si elle n'existe pas
  console.log('4. Vérification / création de Faye...')
  const { data: refreshedNpcs } = await supabase.from('npcs').select('id, name').eq('book_id', BOOK_ID)
  const allNpcs = refreshedNpcs ?? []
  let fayeId = allNpcs.find(n => n.name.toLowerCase() === 'faye')?.id ?? null
  if (!fayeId) {
    const { data: fayeInserted, error } = await supabase.from('npcs').insert({
      book_id: BOOK_ID,
      name: 'Faye',
      type: 'allié',
      description: 'Jeune femme du Bronx. Elle connaît les rotations des Reapers et les angles morts du quartier. Prudente mais juste.',
      force: 5, agilite: 8, endurance: 8, intelligence: 9, magie: 0, chance: 7,
    }).select('id').single()
    if (error) console.error('   ERREUR création Faye:', error.message)
    else { fayeId = fayeInserted.id; console.log(`   ✓ Faye créée (${fayeId})`) }
  } else {
    console.log(`   ✓ Faye existante (${fayeId})`)
  }

  // 5. Créer les NPCs ennemis (templates)
  console.log('5. Création des NPCs ennemis...')
  const npcTemplates = [
    // ── Templates génériques (fallback) ──────────────────────────────────────
    { book_id: BOOK_ID, name: 'Reaper', type: 'ennemi', description: 'Membre des Reapers. Combattant à mains nues (pacte de désarmement).', force: 10, agilite: 8, endurance: 12, intelligence: 5, magie: 0, chance: 5 },
    { book_id: BOOK_ID, name: 'Reaper élite', type: 'ennemi', description: 'Membre aguerri des Reapers, proche de Krugger.', force: 14, agilite: 12, endurance: 16, intelligence: 6, magie: 0, chance: 5 },
    { book_id: BOOK_ID, name: 'Membre de gang', type: 'ennemi', description: "Membre d'un gang adverse, imprévisible.", force: 9, agilite: 10, endurance: 10, intelligence: 5, magie: 0, chance: 5 },
    // ── §2AA-B-echec — Van Cortlandt Park, entre les arbres ──────────────────
    { book_id: BOOK_ID, name: 'Marcus', type: 'ennemi', description: 'Reaper isolé, patrouille de nuit au parc.', force: 11, agilite: 7, endurance: 13, intelligence: 5, magie: 0, chance: 5 },
    // ── §2BB-echec — Centre de la foule ──────────────────────────────────────
    { book_id: BOOK_ID, name: 'DeShawn', type: 'ennemi', description: "Membre d'un gang adverse, opportuniste dans la confusion.", force: 8, agilite: 11, endurance: 10, intelligence: 5, magie: 0, chance: 5 },
    { book_id: BOOK_ID, name: 'Tony', type: 'ennemi', description: "Membre d'un gang adverse, rapide et agressif.", force: 9, agilite: 9, endurance: 9, intelligence: 5, magie: 0, chance: 5 },
    { book_id: BOOK_ID, name: 'Ricky', type: 'ennemi', description: "Membre d'un gang adverse, le plus costaud des trois.", force: 10, agilite: 10, endurance: 11, intelligence: 5, magie: 0, chance: 5 },
    // ── §3-BA-echec — Lisière est du parc ────────────────────────────────────
    { book_id: BOOK_ID, name: 'Lamar', type: 'ennemi', description: 'Reaper en patrouille, lampe torche, réflexes rapides.', force: 9, agilite: 9, endurance: 11, intelligence: 5, magie: 0, chance: 5 },
    // ── §9-echec-B — West 238th, guetteurs ───────────────────────────────────
    { book_id: BOOK_ID, name: 'Calvin', type: 'ennemi', description: 'Reaper guetteur, poste fixe West 238th.', force: 10, agilite: 8, endurance: 12, intelligence: 5, magie: 0, chance: 5 },
    { book_id: BOOK_ID, name: 'Andre', type: 'ennemi', description: 'Reaper guetteur, équipier de Calvin.', force: 11, agilite: 9, endurance: 11, intelligence: 5, magie: 0, chance: 5 },
    // ── §11-echec — West 235th, quai ─────────────────────────────────────────
    { book_id: BOOK_ID, name: 'Darius', type: 'ennemi', description: 'Reaper descendu du quai, vigile de la ligne 4.', force: 10, agilite: 8, endurance: 12, intelligence: 5, magie: 0, chance: 5 },
    { book_id: BOOK_ID, name: 'Hector', type: 'ennemi', description: 'Reaper descendu du quai, partenaire de Darius.', force: 12, agilite: 7, endurance: 14, intelligence: 5, magie: 0, chance: 5 },
    // ── §12-B-echec — Station-service West 231st ─────────────────────────────
    { book_id: BOOK_ID, name: 'Tyrone', type: 'ennemi', description: 'Reaper isolé en faction devant la station-service.', force: 10, agilite: 9, endurance: 12, intelligence: 5, magie: 0, chance: 5 },
    // ── §13-echec — Station-service, arnaque ratée ────────────────────────────
    { book_id: BOOK_ID, name: 'Kareem', type: 'ennemi', description: 'Reaper méfiant, pas le genre à se laisser distraire.', force: 12, agilite: 8, endurance: 13, intelligence: 7, magie: 0, chance: 5 },
    // ── §15-echec — Kingsbridge Armory ───────────────────────────────────────
    { book_id: BOOK_ID, name: 'Jerome', type: 'ennemi', description: 'Reaper de faction à l\'Armory, réactif.', force: 11, agilite: 8, endurance: 12, intelligence: 5, magie: 0, chance: 5 },
    { book_id: BOOK_ID, name: 'Malik', type: 'ennemi', description: 'Reaper de renfort sorti de l\'Armory.', force: 10, agilite: 9, endurance: 11, intelligence: 5, magie: 0, chance: 5 },
    // ── §16-B-echec — Sous les rails ─────────────────────────────────────────
    { book_id: BOOK_ID, name: 'Reggie', type: 'ennemi', description: 'Reaper en patrouille sous les rails.', force: 9, agilite: 10, endurance: 11, intelligence: 5, magie: 0, chance: 5 },
    // ── §17-echec-combat — Kingsbridge Road ──────────────────────────────────
    { book_id: BOOK_ID, name: 'Antoine', type: 'ennemi', description: 'Reaper du groupe de Kingsbridge, rapide.', force: 10, agilite: 8, endurance: 12, intelligence: 5, magie: 0, chance: 5 },
    { book_id: BOOK_ID, name: 'Curtis', type: 'ennemi', description: 'Reaper du groupe de Kingsbridge, le plus fort.', force: 11, agilite: 7, endurance: 13, intelligence: 5, magie: 0, chance: 5 },
    { book_id: BOOK_ID, name: 'Leroy', type: 'ennemi', description: 'Reaper du groupe de Kingsbridge, endurant.', force: 9, agilite: 10, endurance: 11, intelligence: 5, magie: 0, chance: 5 },
    // ── §4-riverdale-C-echec — Fort Independence Park ────────────────────────
    { book_id: BOOK_ID, name: 'Reaper isolé', type: 'ennemi', description: 'Reaper en patrouille solitaire à Fort Independence Park.', force: 10, agilite: 8, endurance: 11, intelligence: 6, magie: 0, chance: 5 },
    // ── §4-sedgwick-bodega-B-echec — Ruelle derrière la bodega ───────────────
    { book_id: BOOK_ID, name: 'Reaper 1', type: 'ennemi', description: 'Reaper de faction devant la bodega.', force: 10, agilite: 8, endurance: 11, intelligence: 5, magie: 0, chance: 5 },
    { book_id: BOOK_ID, name: 'Reaper 2', type: 'ennemi', description: 'Reaper de faction devant la bodega, équipier.', force: 9, agilite: 9, endurance: 11, intelligence: 5, magie: 0, chance: 5 },
    // ── §2AA-C-echec — Van Cortlandt Park, près des clochards ────────────────
    { book_id: BOOK_ID, name: 'Clochard', type: 'neutre', description: 'Vieux ivrogne qui dort dans le parc. Pas dangereux, mais a le nez fin pour sentir une opportunité.', speech_style: 'Voix pâteuse, mots mâchés, opportuniste.', force: 3, agilite: 2, endurance: 5, intelligence: 3, magie: 0, chance: 6 },
  ]
  const npcMap = new Map() // name.toLowerCase() → id
  for (const npc of npcTemplates) {
    const { data: inserted, error } = await supabase.from('npcs').insert(npc).select('id').single()
    if (error) { console.error(`   ERREUR NPC ${npc.name}:`, error.message); continue }
    npcMap.set(npc.name.toLowerCase(), inserted.id)
    console.log(`   ✓ ${npc.name}`)
  }

  // Ajouter les alliés existants dans npcMap pour companion_npc_ids
  const { data: finalNpcs } = await supabase.from('npcs').select('id, name').eq('book_id', BOOK_ID)
  for (const n of (finalNpcs ?? [])) {
    npcMap.set(n.name.toLowerCase(), n.id)
  }
  if (fayeId) npcMap.set('faye', fayeId)

  // 6. Première passe : créer toutes les sections (sans trial, sans companions)
  console.log('6. Création des sections (passe 1 — structure)...')
  const sections = data.tronc_commun
  const idMap = new Map() // §id → uuid
  let sectionNumber = 1
  const unresolvedRefs = new Set()

  // Vérification préalable : toutes les cibles définies ?
  const definedIds = new Set(sections.map(s => s.id))
  for (const s of sections) {
    for (const c of (s.choix ?? [])) {
      if (c.cible && c.cible !== 'FIN-MORT' && !c.cible.startsWith('CHEMIN-') && !definedIds.has(c.cible)) {
        unresolvedRefs.add(`${s.id} → ${c.cible} ("${c.label.slice(0, 40)}...")`)
      }
    }
  }
  if (unresolvedRefs.size) {
    console.log(`\n   ⚠ RÉFÉRENCES MANQUANTES dans le JSON (${unresolvedRefs.size}) :`)
    for (const ref of unresolvedRefs) console.log(`     ! ${ref}`)
    console.log()
  }

  for (const s of sections) {
    const isEndingSection = s.choix?.length === 1 && s.choix[0].cible === 'FIN-MORT'
    const locationId = resolveLocation(s.lieu)

    const payload = {
      book_id: BOOK_ID,
      number: sectionNumber++,
      summary: s.resume,
      content: s.resume,
      status: 'draft',
      is_ending: isEndingSection,
      ending_type: isEndingSection ? 'death' : null,
      location_id: locationId,
    }

    const { data: inserted, error } = await supabase.from('sections').insert(payload).select('id').single()
    if (error) { console.error(`   ERREUR ${s.id}:`, error.message); continue }
    idMap.set(s.id, inserted.id)
    process.stdout.write('.')
  }
  console.log(`\n   ${idMap.size} sections créées`)

  // 7. Deuxième passe : trials + companion_npc_ids
  console.log('7. Mise à jour trials + compagnons (passe 2)...')
  let trialCount = 0
  let companionCount = 0
  for (const s of sections) {
    const sectionId = idMap.get(s.id)
    if (!sectionId) continue

    const updates = {}

    // Trials
    if (TRIAL_TYPES.includes(s.type)) {
      const trial = buildTrial(s, idMap)
      if (trial) {
        if (s.type === 'combat') {
          if (s.combat_config) {
            // ── Nouveau format : combat_config explicite ──────────────
            // NPC principal ennemi (premier de la liste) — cherche par nom exact
            const firstEnnemi = s.combat_config.ennemis?.[0]
            if (firstEnnemi) {
              trial.npc_id = npcMap.get(firstEnnemi.toLowerCase()) ?? npcMap.get('reaper')
            }
          } else {
            // ── Ancien format : lecture depuis npcs[] ─────────────────
            const npcName = s.npcs?.find(n => !ALLIES.includes(n.toLowerCase()
              .replace(' isolé', '').replace(' (groupe)', '').trim()))
            if (npcName) {
              const n = npcName.toLowerCase()
              if (n.includes('élite')) trial.npc_id = npcMap.get('reaper élite')
              else if (n.includes('membre de gang') || n.includes('3 membres')) trial.npc_id = npcMap.get('membre de gang')
              else trial.npc_id = npcMap.get('reaper')
            }
          }
        }
        updates.trial = trial
        trialCount++
      }
    }

    // Companion NPC IDs
    // Si combat_config présent : alliés = combat_config.allies + ennemis supplémentaires (index > 0)
    // Sinon : lecture depuis npcs[] (alliés humains uniquement)
    let companionIds = []
    if (s.combat_config) {
      const allyIds = (s.combat_config.allies ?? [])
        .map(n => npcMap.get(n.toLowerCase())).filter(Boolean)
      // Ennemis supplémentaires (à partir du 2e)
      const extraEnemyIds = (s.combat_config.ennemis ?? []).slice(1)
        .map(n => npcMap.get(n.toLowerCase()) ?? npcMap.get('reaper'))
        .filter(Boolean)
      companionIds = [...new Set([...allyIds, ...extraEnemyIds])]
    } else {
      companionIds = resolveCompanions(s.npcs, npcMap)
    }
    if (companionIds.length) {
      updates.companion_npc_ids = companionIds
      companionCount++
    }

    if (Object.keys(updates).length) {
      const { error } = await supabase.from('sections').update(updates).eq('id', sectionId)
      if (error) console.error(`   ERREUR update ${s.id}:`, error.message)
    }
  }
  console.log(`   ${trialCount} trials mis à jour`)
  console.log(`   ${companionCount} sections avec compagnons`)

  // 8. Créer les choix normaux (non succès/échec)
  console.log('8. Création des choix normaux...')
  let choixCount = 0
  let sortOrder = 0
  // choiceMap : `${fromSectionId}|${targetSectionId}` → choiceUUID (pour discussion_scene)
  const choiceMap = new Map()
  for (const s of sections) {
    const fromId = idMap.get(s.id)
    if (!fromId) continue

    const choixACreer = TRIAL_TYPES.includes(s.type)
      ? (s.choix ?? []).filter(c => !isTrialChoice(c.label))
      : (s.choix ?? []).filter(c => c.cible !== 'FIN-MORT' && !c.cible?.startsWith('CHEMIN-'))

    for (const choix of choixACreer) {
      if (choix.cible === 'FIN-MORT' || choix.cible?.startsWith('CHEMIN-')) continue
      const targetId = idMap.get(choix.cible) ?? null
      const { data: inserted, error } = await supabase.from('choices').insert({
        section_id: fromId,
        label: choix.label,
        target_section_id: targetId,
        requires_trial: false,
        sort_order: sortOrder++,
        ...(choix.money_cost != null ? { money_cost: choix.money_cost } : {}),
      }).select('id').single()
      if (error) { console.error(`   ERREUR choix ${s.id}→${choix.cible}:`, error.message); continue }
      if (inserted && targetId) choiceMap.set(`${fromId}|${targetId}`, inserted.id)
      choixCount++
    }
  }
  console.log(`   ${choixCount} choix créés`)

  // 9. Créer les items
  console.log('9. Création des items...')

  // Mapping correct : nom item → id JSON de la section où il est trouvé
  const ITEM_SECTION_MAP = {
    'Paquet de cigarettes': '§3B',                      // trouvé dans l'herbe, lisière est
    'La Carte':             '§2AA-C',                   // cachée dans l'image des clochards
    'Couteau':              '§5',                       // donné par Faye si dialogue réussi
    'Bandana Reaper':       '§13',                      // arraché au Reaper neutralisé
    'Radio':                '§15',                      // volée au Reaper près de l'Armory
    'Clé de voiture':       '§9-echec-B',               // butin combat guetteurs West 238th
    'Téléphone Reaper':     '§4-sedgwick-bodega-B-echec', // butin combat ruelle bodega
  }

  const ITEM_USED_MAP = {
    'Paquet de cigarettes': ['§5'],
    'La Carte':             [],
    'Couteau':              [],
    'Bandana Reaper':       [],
    'Radio':                [],
    // '30 dollars' : stat numérique dans le simulateur, pas un item
    'Clé de voiture':       ['§10', '§10-C'],
    'Téléphone Reaper':     [],
  }

  let itemCount = 0
  for (const item of data.objets) {
    const sectionFoundKey = ITEM_SECTION_MAP[item.name]
    const sectionFoundId = sectionFoundKey ? (idMap.get(sectionFoundKey) ?? null) : null
    const usedKeys = ITEM_USED_MAP[item.name] ?? []
    const sectionsUsed = usedKeys.map(k => idMap.get(k)).filter(Boolean)

    if (sectionFoundKey && !sectionFoundId) {
      console.log(`   ⚠ ${item.name} : section "${sectionFoundKey}" non trouvée dans idMap`)
    }

    const { error } = await supabase.from('items').insert({
      book_id: BOOK_ID,
      name: item.name,
      item_type: item.item_type,
      category: item.category,
      description: item.description,
      weapon_type: item.weapon_type ?? null,
      effect: item.effect ?? {},
      section_found_id: sectionFoundId,
      sections_used: sectionsUsed,
    })
    if (error) { console.error(`   ERREUR item ${item.name}:`, error.message); continue }
    itemCount++
    const secNum = sectionFoundId
      ? `§${sections.findIndex(s => idMap.get(s.id) === sectionFoundId) + 1} (${sectionFoundKey})`
      : 'départ'
    console.log(`   ✓ ${item.name} — trouvé en ${secNum}`)
  }

  // 10. Discussion scenes (tables relationnelles)
  console.log('10. Création des discussion_scenes (tables relationnelles)...')
  let discCount = 0

  // Supprimer les scènes existantes (cascade sur discussion_choices)
  await supabase.from('discussion_scenes').delete().in('section_id', [...idMap.values()])

  // Résout les slugs → UUIDs et retourne les choix prêts pour le JSONB
  function resolveChoices(choices) {
    return (choices ?? []).map(c => {
      const targetSectionId = c.section_choice_id ? (idMap.get(c.section_choice_id) ?? null) : null
      return {
        id: c.id ?? undefined,
        player_text: c.player_text ?? null,
        emotion_label: c.emotion_label ?? null,
        npc_response: c.npc_response ?? null,
        npc_capitulation: c.npc_capitulation ?? undefined,
        ...(targetSectionId ? { target_section_id: targetSectionId } : {}),
        ...(c.condition ? { condition_item: c.condition } : {}),
        ...(c.sub_choices?.length ? { sub_choices: resolveChoices(c.sub_choices) } : {}),
      }
    })
  }

  async function insertChoices(choices, sceneId, parentId) {
    for (let i = 0; i < choices.length; i++) {
      const c = choices[i]

      // Résoudre slug section → UUID pour target_section_id
      let targetSectionId = null
      if (c.section_choice_id) {
        targetSectionId = idMap.get(c.section_choice_id) ?? null
        if (!targetSectionId) console.log(`   ⚠ section cible introuvable : ${c.section_choice_id}`)
      }

      const { data: inserted, error } = await supabase.from('discussion_choices').insert({
        scene_id: sceneId,
        parent_id: parentId ?? null,
        sort_order: i,
        player_text: c.player_text ?? null,
        emotion_label: c.emotion_label ?? null,
        npc_response: c.npc_response ?? null,
        npc_capitulation: c.npc_capitulation ?? null,
        target_section_id: targetSectionId,
        condition_item: c.condition ?? null,
      }).select('id').single()

      if (error) { console.error(`   ERREUR choix discussion:`, error.message); continue }

      // Récursivement insérer les sous-choix
      if (c.sub_choices?.length) {
        await insertChoices(c.sub_choices, sceneId, inserted.id)
      }
    }
  }

  for (const s of sections) {
    if (!s.discussion_scene) continue
    const sectionDbId = idMap.get(s.id)
    if (!sectionDbId) continue

    const disc = s.discussion_scene

    // Résoudre npc_name → npc_id
    let npcId = disc.npc_id ?? null
    if (!npcId && disc.npc_name) {
      npcId = npcMap.get(disc.npc_name.toLowerCase()) ?? null
      if (!npcId) console.log(`   ⚠ NPC introuvable : ${disc.npc_name}`)
    }

    // Créer la scène
    const { data: scene, error: sceneErr } = await supabase.from('discussion_scenes').insert({
      section_id: sectionDbId,
      npc_id: npcId,
      npc_opening: disc.npc_opening ?? null,
      outcome_thought: disc.outcome_thought ?? null,
    }).select('id').single()

    if (sceneErr) { console.error(`   ERREUR scene ${s.id}:`, sceneErr.message); continue }

    // Insérer les choix récursivement
    await insertChoices(disc.choices ?? [], scene.id, null)

    // Mettre à jour le cache JSONB (pour admin + simulateur)
    const resolvedChoices = resolveChoices(disc.choices ?? [])
    await supabase.from('sections').update({
      discussion_scene: {
        scene_id: scene.id,
        npc_id: npcId,
        npc_opening: disc.npc_opening ?? null,
        outcome_thought: disc.outcome_thought ?? null,
        choices: resolvedChoices,
      }
    }).eq('id', sectionDbId)

    discCount++
    const npcName = disc.npc_name ?? disc.npc_id ?? '?'
    console.log(`   ✓ ${s.id} — discussion avec ${npcName}`)
  }
  console.log(`   ${discCount} discussion_scenes créées`)

  // 11. Résumé
  console.log('\n=== TERMINÉ ===')
  console.log(`Sections    : ${idMap.size} (sur ${sections.length})`)
  console.log(`Trials      : ${trialCount}`)
  console.log(`Compagnons  : ${companionCount} sections renseignées`)
  console.log(`Choix       : ${choixCount}`)
  console.log(`Items       : ${itemCount}`)
  console.log(`Discussions : ${discCount}`)
  console.log(`NPCs        : ${npcMap.size}`)
  if (unresolvedRefs.size) {
    console.log(`\n⚠ ${unresolvedRefs.size} référence(s) manquante(s) dans le JSON — choix créés sans cible.`)
    console.log('  À corriger : §2BAB, §4-sedgwick-AB')
  }
}

main().catch(console.error)
