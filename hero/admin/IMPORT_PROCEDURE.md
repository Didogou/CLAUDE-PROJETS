# Procédure d'import — Freaks Tome 1

## Fichiers
- `d:/Projets/Claude-projets/hero/freaks_tome1_sections.json` — source de vérité (sections, objets, templates ennemis)
- `d:/Projets/Claude-projets/hero/admin/import_sections.mjs` — script d'import principal

## Prérequis
- Node.js installé
- `@supabase/supabase-js` installé dans `hero/` (`npm install @supabase/supabase-js`)
- Book ID : `e73923c7-a1c9-480e-8267-d69c5ca885b8` (Warriors : La Nuit du Bronx)

## Ce que fait le script

1. **Supprime** les sections, choix et items existants du livre
2. **Supprime** les NPCs ennemis (garde Travis, Shawn, Zac, James, Jesse, Adam)
3. **Crée** les NPCs ennemis : Reaper, Reaper élite, Membre de gang
4. **Crée** les sections avec : résumé, contenu, localisation, statut draft, is_ending
5. **Met à jour** les trials (combat/chance/agilité/intelligence/dialogue) avec success_section_id et failure_section_id
6. **Crée** les choix normaux (non succès/échec)
7. **Crée** les items avec section_found_id et sections_used

## Lancer l'import

```bash
cd "d:/Projets/Claude-projets/hero/admin"
node --experimental-specifier-resolution=node import_sections.mjs
```

## Après l'import — étapes manuelles

### 1. Supprimer les doublons NPCs alliés
```bash
cd "d:/Projets/Claude-projets/hero/admin"
node --input-type=module << 'EOF'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BOOK_ID = 'e73923c7-a1c9-480e-8267-d69c5ca885b8'
const { data: npcs } = await supabase.from('npcs').select('id, name, created_at').eq('book_id', BOOK_ID).in('name', ['Travis','Shawn','Zac','James','Jesse','Adam']).order('created_at')
const grouped = {}
for (const n of npcs) { const key = n.name.toLowerCase(); if (!grouped[key]) grouped[key] = n }
const keepIds = Object.values(grouped).map(n => n.id)
const deleteIds = npcs.filter(n => !keepIds.includes(n.id)).map(n => n.id)
if (deleteIds.length) { await supabase.from('npcs').delete().in('id', deleteIds); console.log(`${deleteIds.length} doublons supprimés`) }
else console.log('Aucun doublon')
EOF
```

### 2. Assigner les companion_npc_ids
```bash
node --input-type=module << 'EOF'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BOOK_ID = 'e73923c7-a1c9-480e-8267-d69c5ca885b8'
const data = JSON.parse(readFileSync('d:/Projets/Claude-projets/hero/freaks_tome1_sections.json', 'utf-8'))
const NPC_MAP = {
  'travis': '37e57981-0629-4ee7-8549-804296722408',
  'shawn':  '30ef6907-9e45-4ad8-95c5-d260922bab6b',
  'zac':    '3859dd94-fe54-4775-824d-eabd157dfb00',
  'james':  '7403bcf8-836a-48fc-a628-8870b5770e56',
  'jesse':  '761dcf64-b096-4cd0-ac19-7ebf93f4bf6f',
  'adam':   '32840d81-f97b-48f9-8572-2c3ef7c9b2c1',
}
const { data: dbSections } = await supabase.from('sections').select('id, number').eq('book_id', BOOK_ID).order('number')
const sections = data.tronc_commun
let updated = 0
for (let i = 0; i < sections.length; i++) {
  const s = sections[i]; const dbSection = dbSections[i]; if (!dbSection) continue
  const companionIds = (s.npcs ?? []).map(n => NPC_MAP[n.toLowerCase().split(' ')[0]]).filter(Boolean)
  if (!companionIds.includes(NPC_MAP['travis'])) companionIds.unshift(NPC_MAP['travis'])
  await supabase.from('sections').update({ companion_npc_ids: companionIds }).eq('id', dbSection.id)
  updated++
}
console.log(`${updated} sections mises à jour`)
EOF
```

## NPCs alliés — IDs fixes
| Nom    | ID |
|--------|----|
| Travis | `37e57981-0629-4ee7-8549-804296722408` |
| Shawn  | `30ef6907-9e45-4ad8-95c5-d260922bab6b` |
| Zac    | `3859dd94-fe54-4775-824d-eabd157dfb00` |
| James  | `7403bcf8-836a-48fc-a628-8870b5770e56` |
| Jesse  | `761dcf64-b096-4cd0-ac19-7ebf93f4bf6f` |
| Adam   | `32840d81-f97b-48f9-8572-2c3ef7c9b2c1` |

## Localisations — mapping
| Lieu JSON | Localisation DB |
|-----------|----------------|
| Van Cortlandt Park, centre, lisière | Clairière de Van Cortlandt |
| Entre les arbres, clochards, lac | Bois de Van Cortlandt Lake |
| Lisière est | Lisière Est du Parc |
| Jerome Avenue, West 238th/235th/231st | Jerome Avenue — Piliers du métro aérien |
| Garages | Jerome Avenue — Garages |
| Sedgwick, Bailey, cour intérieure | Bailey Avenue — Trottoirs résidentiels |
| Bodega | Sedgwick Avenue — Bodega |
| Riverdale, sommet, montée boisée | Collines de Riverdale |
| Fort Independence | Fort Independence Park |
| Kingsbridge Armory, Kingsbridge Road | Kingsbridge Armory |
| Station-service | Station-service West 231st |
| Harlem River, berges | Berges de la Harlem River |

## Notes
- Les 30 dollars sont un objet de départ — pas ramassable, pas positionnable
- La Carte est ramassable et à positionner sur les images §2AA-B et §2AA-C
- Le contenu des sections est le résumé — à enrichir via Mistral avant test de jouabilité
- Les choix vers CHEMIN-A/B/C (bifurcation finale §18) sont sans cible pour l'instant
