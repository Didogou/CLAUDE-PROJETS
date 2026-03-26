import type { GenerateBookParams, Project, Book, Section, Choice, NarrativeArc } from '@/types'

const WEAPON_GUIDE: Record<string, string> = {
  'Fantasy':           'Épées, haches, arcs, dagues, lances, boucliers runiques, bâtons magiques. Magie élémentaire (feu, glace, foudre). Armures de plates ou de cuir.',
  'Médiéval':          'Épées longues, masses d\'armes, flaux, arbalètes, arcs longs, hallebardes. Pas de magie — uniquement armes de corps à corps ou à distance de l\'époque médiévale.',
  'Science-Fiction':   'Pistolets laser, fusils à plasma, grenades ioniques, lames monofilament, exosquelettes, drones de combat, canons à impulsion. Pas d\'armes médiévales.',
  'Cyberpunk':         'Pistolets modificés, fusils smartgun, lames cybernétiques, implants de combat, grenades EMP, pistolets à fléchettes, neural-hackers. Technologie et street-tech.',
  'Post-Apocalyptique':'Armes improvisées (barres de métal, chaînes, couteaux rouillés), fusils à pompe, revolvers, arbalètes de fortune, cocktails Molotov, bombes artisanales.',
  'Horreur':           'Armes banales détournées (haches, couteaux de cuisine, tuyaux), fusils de chasse, pieux, crucifix, sel béni, artefacts rituels. Tension > puissance.',
  'Polar':             'Pistolets (Beretta, Glock), revolvers, couteaux de poche, matraques, armes improvisées urbaines. Style film noir — précision et brutalité réaliste.',
  'Historique':        'Armes de l\'époque représentée : sandales et glaives (Rome), katanas et shuriken (Japon féodal), mousquets et sabres (XVIIe), etc. Cohérence historique absolue.',
  'Contemporain':      'Armes réalistes du monde moderne : poings, couteaux, battes, pistolets, armes réglementaires. Combats urbains, confrontations verbales, filatures, hacking. Pas de magie ni de science-fiction.',
}

const DIFFICULTY_GUIDE: Record<string, string> = {
  facile:    'Ennemis faibles (force 3-7, endurance 6-10). Fins : 4-6 victoires, 1-2 morts. Beaucoup de récompenses, épreuves rares. XP: ennemi 30-60, boss 80-120. Nombreux objets de soin. La majorité des chemins mène à la victoire.',
  normal:    'Ennemis équilibrés (force 5-12, endurance 8-15). Fins : 3-4 victoires, 2-3 morts. Récompenses modérées. XP: ennemi 50-100, boss 150-200. Mix équilibré de chemins victoire et mort.',
  difficile: 'Ennemis forts (force 8-16, endurance 12-22). Fins : 2-3 victoires, 4-5 morts. Récompenses rares. XP: ennemi 80-130, boss 200-280. Pénalités sévères. La plupart des chemins mènent à la mort — la victoire est rare et méritée.',
  expert:    'Ennemis redoutables (force 12-18, endurance 18-35). Fins : 1-2 victoires seulement, 5-7 morts. Récompenses très rares. XP: ennemi 100-180, boss 250-350. Chaque erreur peut être fatale. Il n\'existe qu\'un ou deux chemins étroits vers la victoire.',
}

export function buildBookStructurePrompt(params: GenerateBookParams): string {
  const { title, theme, age_range, context_type, language, num_sections, difficulty, content_mix, map_style } = params
  const lang = language === 'fr' ? 'français' : 'anglais'
  const diffLabel = { facile: 'Facile', normal: 'Normal', difficile: 'Difficile', expert: 'Expert' }[difficulty]
  const weaponGuide = WEAPON_GUIDE[theme] ?? 'Armes cohérentes avec l\'univers du livre.'
  const withMap = !!map_style
  const isTu = params.address_form === 'tu'
  const addressNote = isTu
    ? '- Écriture à la 2ème personne du singulier TUTOIEMENT ("Tu avances...", "Tu sens...", "Tu vois...")'
    : '- Écriture à la 2ème personne du singulier VOUVOIEMENT ("Vous avancez...", "Vous sentez...", "Vous voyez...")'
  const exampleSummary = isTu
    ? '"Tu affrontes le garde devant la porte de la tour"'
    : '"Vous affrontez le garde devant la porte de la tour"'

  const mix = content_mix ?? { combat: 20, chance: 10, enigme: 10, magie: 5 }
  const total = mix.combat + mix.chance + mix.enigme + mix.magie
  const narration = Math.max(100 - total, 10)
  const toCount = (pct: number) => Math.max(1, Math.round((pct / 100) * num_sections))
  const mixGuide = [
    `- ⚔️  Combat physique  : ${mix.combat}% → environ ${toCount(mix.combat)} section(s)`,
    `- 🎲 Chance           : ${mix.chance}% → environ ${toCount(mix.chance)} section(s)`,
    `- 🧩 Énigme/Intel.    : ${mix.enigme}% → environ ${toCount(mix.enigme)} section(s)`,
    `- ✨ Combat magique   : ${mix.magie}% → environ ${toCount(mix.magie)} section(s)`,
    `- 📖 Narration pure   : ${narration}% → environ ${toCount(narration)} section(s)`,
  ].join('\n')

  return `Tu es un auteur expert de livres "Dont Vous Êtes le Héros" dans le style de Pierre Bordage.

Style d'écriture :
- Phrases courtes, rythmées, percutantes
- Atmosphère immersive et sensorielle (sons, odeurs, lumières, textures)
- Tension narrative permanente
${addressNote}
- Univers cohérent et détaillé

Paramètres du livre :
- Titre : "${title}"
- Thème : ${theme}
- Ambiance : ${context_type}
- Public cible : ${age_range} ans
- Langue : ${lang}
- Nombre de sections : ${num_sections}
- Difficulté : ${diffLabel} — ${DIFFICULTY_GUIDE[difficulty]}
- Armes & équipements : ${weaponGuide}
${params.description?.trim() ? `
Contexte et inspiration fournis par l'auteur (à interpréter et intégrer fidèlement dans l'univers du livre) :
${params.description.trim()}
` : ''}

Répartition des types de sections à respecter :
${mixGuide}
IMPORTANT : respecte ces proportions aussi fidèlement que possible dans la distribution des sections.

Génère la structure complète du livre en JSON avec ${withMap ? 'trois' : 'deux'} parties :

1. Les PNJ (personnages non joueurs) qui apparaissent dans le livre.
2. Les sections narratives du livre.${withMap ? `
3. Les lieux de l'aventure (carte).` : ''}

Règles pour les PNJ :
- Crée entre 4 et 10 PNJ cohérents avec l'univers (ennemis, boss, alliés, neutres, marchands)
- Les boss ont des stats élevées (endurance 20-40, force 10-18)
- Les ennemis ordinaires ont des stats moyennes (endurance 8-15, force 5-12)
- Les alliés/neutres ont des stats cohérentes avec leur rôle narratif
- Chaque PNJ a une capacité spéciale unique, des résistances et un butin si pertinent
- Les armes, armures et butins des PNJ DOIVENT être cohérents avec le thème "${theme}" (voir guide armes ci-dessus)
- Chaque PNJ DOIT avoir un champ "speech_style" décrivant sa façon de parler : accent régional ou étranger, niveau de langue (familier/soutenu/argot), tics de langage, expressions récurrentes, rythme. Ex: "Parle avec un accent du Sud, utilise 'Hé, l'ami !' comme accroche, phrases courtes et directes, tutoie toujours le joueur", ou "Vieux sage : parle lentement, utilise des métaphores poétiques, vocabulaire soutenu, ne répond jamais directement"
- Les PNJ alliés, neutres et marchands auront souvent des sections de dialogue (type "dialogue") — leur speech_style est crucial pour ces échanges
- Ajouter un champ "dialogue_intro" optionnel : texte bref (1-2 phrases) du narrateur décrivant comment le PNJ s'adresse au joueur pour la première fois
- Les stats vont de 1 à 20 (sauf endurance boss jusqu'à 40)

${withMap ? `Règles pour les lieux (carte) :
- Crée entre 5 et 15 lieux uniques qui couvrent tous les espaces narratifs de l'aventure
- Plusieurs sections peuvent se passer dans le même lieu (ex: 3 sections dans "La Taverne du Dragon")
- Les noms de lieux sont courts, évocateurs, cohérents avec l'univers "${theme}"
- Chaque lieu a un emoji "icon" représentatif (🏰 donjon, 🌲 forêt, 🏙️ ville, ⚓ port, etc.)
- Les coordonnées x et y (0 à 100) représentent la position géographique RELATIVE sur la carte, de façon cohérente (ex: nord=y faible, sud=y élevé, est=x élevé, ouest=x faible)
- Dis-toi : si je dessinais cette carte sur une feuille, où serait chaque lieu les uns par rapport aux autres ?
- Chaque section DOIT avoir un champ "location_name" correspondant exactement au "name" d'un lieu ci-dessus

` : ''}Règles pour les sections :
- La section 1 est toujours le point de départ
- NE PAS inclure le texte narratif ("content") — il sera généré séparément
- Chaque section DOIT avoir un champ "summary" : 2 à 3 phrases (40-50 mots max) décrivant l'action clé, l'atmosphère, et comment la scène se termine ou ouvre sur les choix. Ex pour un combat : "Trois gardes bloquent le couloir, torches à la main. Le combat est inévitable — les murs suintent d'humidité, l'air sent la cire et la rouille. Si vous survivez, la porte de la crypte s'ouvre devant vous."
- Nombre de choix par section : la majorité des sections ont 2 choix, mais n'hésite pas à en proposer 3 ou 4 aux carrefours narratifs importants pour enrichir le jeu. Certaines sections (fins, issues d'épreuve) n'en ont aucun.
- Choix "rebrousser chemin" : dans environ 15% des sections de narration (pas d'épreuve, pas de fin), tu PEUX ajouter un choix avec "is_back": true qui permet au joueur de revenir vers une section précédente narrativement cohérente (une section déjà visitée dans le cheminement logique). Ce choix doit avoir un libellé naturel et immersif (ex: "Retourner à l'auberge", "Revenir sur tes pas", "Repartir vers la forêt"). Il est interdit de pointer vers une section qui n'existe pas encore dans le flux narratif.
- INTERDIT : deux sections de combat (trial.type = "combat") consécutives dans le même chemin narratif — toujours intercaler au moins une section de narration, dialogue, chance ou autre épreuve entre deux combats
- Les épreuves de combat DOIVENT référencer "enemy_name" avec le nom exact d'un PNJ créé ci-dessus
- OBLIGATION : toute section avec un trial DOIT avoir success_section ET failure_section définis
- En cas de victoire : attribuer xp_reward (boss: 150-300 XP, ennemi: 50-100 XP) et item_rewards si l'histoire le permet (tableau de strings, ex: ["Épée +2", "Potion de soin"])
- En cas d'échec : définir endurance_loss_on_failure (dégâts subis) et une section de repli narrative. IMPORTANT : l'échec d'un combat ne mène PAS automatiquement à la mort — la plupart des défaites doivent mener à une section narrative (fuite, capture, blessure grave, repli forcé). Seuls les combats contre un boss final ou à un moment clairement fatal peuvent mener à une fin mort (is_ending:true). Une défaite ordinaire = conséquences narratives, pas game over.
- Combats magiques (type "magie") : inclure mana_cost (coût en mana du sort lancé, ex: 3)
- Les épreuves non-combat (agilite, intelligence, chance, crochetage) n'ont pas d'enemy_name mais ont obligatoirement success_section et failure_section
- Les sections de type "dialogue" utilisent trial.type = "dialogue" et référencent un PNJ via enemy_name. Elles ont obligatoirement : success_section (joueur convainc/obtient ce qu'il veut), failure_section (joueur échoue ou offense le PNJ), "dialogue_opening" (première réplique du PNJ en restant dans son speech_style), "dialogue_goal" (ce que le joueur doit accomplir dans la conversation, ex: "Convaincre le marchand de vous révéler l'emplacement du temple caché")
- Le nombre de fins victoire et de fins mort doit respecter strictement les proportions indiquées dans le guide de difficulté ci-dessus
- Les embranchements doivent former un arbre cohérent sans sections orphelines

IMPORTANT : ta réponse doit commencer IMMÉDIATEMENT par { et se terminer par }. Aucun texte avant, aucun texte après, aucun bloc \`\`\`json. Uniquement du JSON brut valide dans ce format :
{${withMap ? `
  "locations": [
    { "name": "La Taverne du Dragon", "x": 20, "y": 70, "icon": "🍺" },
    { "name": "La Forêt Maudite",     "x": 60, "y": 30, "icon": "🌲" },
    { "name": "Tour du Sorcier",      "x": 80, "y": 15, "icon": "🏰" }
  ],` : ''}
  "npcs": [
    {
      "name": "Seigneur Malven",
      "type": "boss",
      "description": "Un sorcier déchu au visage scarifié, vêtu de robes noires. Il règne par la terreur depuis vingt ans.",
      "force": 14,
      "agilite": 8,
      "intelligence": 16,
      "magie": 18,
      "endurance": 30,
      "chance": 5,
      "special_ability": "Éclair de ténèbres — inflige 4 dégâts supplémentaires si le joueur n'a pas d'amulette",
      "resistances": "Immunisé à la magie du feu, vulnérable à la lumière sacrée",
      "loot": "Sceptre maudit (+3 magie), Parchemin de téléportation"
    },
    {
      "name": "Garde de la Tour",
      "type": "ennemi",
      "description": "Un soldat en armure rouillée, fidèle jusqu'à la mort.",
      "force": 9,
      "agilite": 6,
      "intelligence": 4,
      "magie": 0,
      "endurance": 12,
      "chance": 5,
      "special_ability": null,
      "resistances": "Résistant aux armes légères",
      "loot": "Épée courte, 10 pièces d'argent",
      "speech_style": "Aboie ses ordres, langage militaire bref, vouvoie mais avec mépris, ponctue ses phrases de 'Soldat !'",
      "dialogue_intro": null
    },
    {
      "name": "Vieille Mira",
      "type": "neutre",
      "description": "Une herboriste édentée qui connaît tous les secrets du village.",
      "force": 2, "agilite": 3, "intelligence": 14, "magie": 6, "endurance": 6, "chance": 8,
      "special_ability": null, "resistances": null, "loot": null,
      "speech_style": "Parle en murmurant, mélange des mots anciens incompréhensibles, rit souvent sans raison, appelle le joueur 'mon moineau', ne répond jamais directement",
      "dialogue_intro": "Une vieille femme aux yeux laiteux vous fait signe depuis l'ombre de sa boutique. 'Psst, mon moineau… t'as l'air de chercher quelque chose…'"
    }
  ],
  "sections": [
    {
      "number": 1,
      "summary": "Vous arrivez aux portes de la cité maudite",
      "is_ending": false,
      "ending_type": null,
      "trial": null,${withMap ? `
      "location_name": "La Taverne du Dragon",` : ''}
      "choices": [
        { "label": "...", "target_section": 2, "sort_order": 0 },
        { "label": "...", "target_section": 5, "sort_order": 1 },
        { "label": "Retourner à l'auberge", "target_section": 1, "sort_order": 2, "is_back": true }
      ]
    },
    {
      "number": 3,
      "is_ending": false,
      "ending_type": null,
      "trial": {
        "type": "combat",
        "stat": "force",
        "enemy_name": "Garde de la Tour",
        "success_section": 7,
        "failure_section": 12,
        "xp_reward": 75,
        "item_rewards": ["Épée courte", "10 pièces d'argent"],
        "endurance_loss_on_failure": 3
      },${withMap ? `
      "location_name": "La Forêt Maudite",` : ''}
      "choices": []
    }
  ]
}`
}

// ── Phase 0 : Découpe en 3 actes ──────────────────────────────────────────────

export function buildActSplitPrompt(
  title: string,
  theme: string,
  synopsis: string,
  numSections: number
): string {
  const act1End = Math.floor(numSections / 3)
  const act2End = Math.floor(2 * numSections / 3)

  return `Tu es un auteur expert en structure narrative (méthode des 3 actes).

Livre : "${title}" — ${theme}
Nombre de sections : ${numSections}

Synopsis complet :
${synopsis}

Découpe ce synopsis en 3 actes narratifs cohérents :
- Acte 1 (sections 1-${act1End}) : MISE EN PLACE — introduction du héros, du monde, des enjeux
- Acte 2 (sections ${act1End + 1}-${act2End}) : CONFRONTATION — développement, obstacles, point de bascule
- Acte 3 (sections ${act2End + 1}-${numSections}) : RÉSOLUTION — climax, fins victoire et mort

Pour chaque acte :
- Un titre court et évocateur (3-5 mots)
- Un synopsis détaillé (150-250 mots) : événements clés, PNJ impliqués, lieux, comment l'acte se termine

Réponds UNIQUEMENT avec du JSON brut valide :
[
  { "title": "...", "synopsis": "...", "from_section": 1, "to_section": ${act1End} },
  { "title": "...", "synopsis": "...", "from_section": ${act1End + 1}, "to_section": ${act2End} },
  { "title": "...", "synopsis": "...", "from_section": ${act2End + 1}, "to_section": ${numSections} }
]`
}

// ── Phase 1b : NPCs + Lieux uniquement ────────────────────────────────────────

export function buildNpcLocationPrompt(
  params: Pick<GenerateBookParams, 'title' | 'theme' | 'context_type' | 'age_range' | 'language' | 'num_sections' | 'difficulty' | 'map_style' | 'description' | 'address_form'> & { book_summary?: string },
  seriesBible?: string | null
): string {
  const withMap = !!params.map_style
  const weaponGuide = WEAPON_GUIDE[params.theme] ?? "Armes cohérentes avec l'univers."
  const description = [
    params.book_summary ? `Résumé du livre :\n${params.book_summary}` : '',
    seriesBible ? `Bible de série :\n${seriesBible.slice(0, 1500)}` : '',
    params.description ?? '',
  ].filter(Boolean).join('\n\n')

  return `Tu es un auteur expert de livres "Dont Vous Êtes le Héros".

Livre : "${params.title}" — ${params.theme} — ${params.context_type} — ${params.age_range} ans — ${params.num_sections} sections
Armes : ${weaponGuide}
${description.trim() ? `Contexte :\n${description.trim()}\n` : ''}
Génère UNIQUEMENT les PNJ et les lieux (pas les sections).

Règles PNJ :
- OBLIGATOIRE : tout personnage nommé dans le synopsis/résumé DOIT être créé comme PNJ (exemple : si "Shawn" et "Travis" sont mentionnés, ils doivent apparaître dans la liste)
- En plus des personnages nommés : ajouter des PNJ secondaires pour atteindre 6 à 12 PNJ au total (ennemis, boss, alliés, neutres, marchands)
- Boss : endurance 20-40, force 10-18. Ennemis : endurance 8-15, force 5-12
- Chaque PNJ : name, type, description, appearance, origin, force, agilite, intelligence, magie, endurance, chance, special_ability, resistances, loot, speech_style, dialogue_intro
- RÈGLE TYPE (critique) : déduire le type depuis le synopsis. Valeurs exactes autorisées : "ennemi", "boss", "allié", "neutre", "marchand". Si le synopsis indique qu'un personnage est un compagnon, ami, allié ou mentor du héros → type OBLIGATOIREMENT "allié". Si antagoniste principal → "boss". Si antagoniste secondaire → "ennemi". Si marchand ou prestataire → "marchand". Si ambivalent → "neutre". Ne jamais mettre "ennemi" par défaut pour un personnage clairement allié.
- appearance : description physique précise (morphologie, couleur cheveux/yeux, cicatrices, vêtements, accessoires). 2-3 phrases. Si le personnage est décrit dans le synopsis, utiliser exactement cette description.
- origin : origine géographique, sociale ou raciale du personnage. 1-2 phrases. Si le personnage est décrit dans le synopsis, utiliser exactement cette origine.
- speech_style : accent, niveau de langue, tics, expressions. Ex : "Vieux sage : métaphores, vocabulaire soutenu, ne répond jamais directement"
${withMap ? `
Règles lieux :
- 8 à 15 lieux couvrant tous les espaces narratifs
- Coordonnées x/y (0-100) cohérentes géographiquement
- Chaque lieu : name (court, évocateur), x, y, icon (emoji)` : ''}

Réponds UNIQUEMENT avec du JSON brut valide :
{${withMap ? `
  "locations": [{ "name": "...", "x": 30, "y": 50, "icon": "🏰" }],` : ''}
  "npcs": [{ "name": "...", "type": "boss", "description": "...", "appearance": "Grand, cheveux gris, cicatrice sur la joue gauche, cape noire usée.", "origin": "Ancien chevalier de l'empire déchu, exilé depuis vingt ans.", "force": 14, "agilite": 8, "intelligence": 12, "magie": 0, "endurance": 28, "chance": 5, "special_ability": "...", "resistances": "...", "loot": "...", "speech_style": "...", "dialogue_intro": null }]
}`
}

// ── Phase 1b-bis : Objets depuis le synopsis ───────────────────────────────────

export function buildItemsPrompt(
  title: string,
  theme: string,
  synopsis: string,
  totalSections: number
): string {
  return `Tu es un auteur expert de livres "Dont Vous Êtes le Héros".

Livre : "${title}" — ${theme}
Nombre total de sections : ${totalSections}

Synopsis :
${synopsis}

Ta mission : générer la liste complète des objets du livre.

─── RÈGLE 1 : objets du synopsis ───
Le synopsis peut lister explicitement des objets avec leur catégorie (persistant, consommable, arme). Respecte-les tels quels.

─── RÈGLE 2 : objets inventés par toi ───
Tu PEUX inventer des objets supplémentaires (uniquement consommable ou arme, jamais persistant) qui enrichissent narrativement l'histoire. Ex : un pied de biche, une grenade fumigène, un couteau de cuisine.

─── RÈGLE 3 : catégories ───
- persistant : reste dans l'inventaire, consultable à tout moment (radio, plan, carte, grimoire central)
- consommable : disparaît après usage unique (clef, potion, billet)
- arme : reste dans l'inventaire, utilisable en combat

─── RÈGLE 4 : sections ───
Pour chaque objet :
- pickup_section_numbers : liste de numéros de sections (1 à ${totalSections}) où l'objet est physiquement présent et peut être ramassé. L'objet peut être dans plusieurs sections si des chemins alternatifs existent.
- use_section_numbers : liste de numéros de sections où l'objet est REQUIS pour déverrouiller un choix (porte, passage, information). Uniquement pour consommable et arme. Vide pour persistant.
- locked_hint : texte affiché dans le choix verrouillé si le joueur n'a pas l'objet (ex: "Cette porte semble nécessiter quelque chose…"). Uniquement si use_section_numbers non vide.

─── RÈGLE 5 : radio ───
Si un objet persistant est une radio ou équivalent (appareil de communication, scanner…), génère des messages broadcasts pour chaque acte narratif majeur du livre (3 à 5 messages). Chaque message est lu par une voix de DJ/commentatrice radio qui donne des nouvelles sur le joueur depuis l'extérieur (prime, signalement, rumeur).

─── FORMAT ───
Réponds UNIQUEMENT avec du JSON brut valide :
[{
  "name": "La Radio",
  "item_type": "quete",
  "category": "persistant",
  "description": "Un vieux transistor crachotant, voix de la DJ Mira.",
  "effect": {},
  "pickup_section_numbers": [3],
  "use_section_numbers": [],
  "locked_hint": "",
  "radio_broadcasts": [
    { "act": 1, "text": "Avis de recherche : une prime de 10 000 crédits est offerte pour..." },
    { "act": 2, "text": "Des témoins signalent une présence suspecte dans le secteur nord..." }
  ]
},
{
  "name": "Pied-de-biche",
  "item_type": "outil",
  "category": "consommable",
  "description": "Un outil robuste qui force n'importe quelle serrure rouillée.",
  "effect": {},
  "pickup_section_numbers": [7],
  "use_section_numbers": [14],
  "locked_hint": "Cette porte semble nécessiter un outil pour être forcée…",
  "radio_broadcasts": []
}]`
}

// ── Phase 1c : lot de sections ─────────────────────────────────────────────────

export function buildSectionBatchPrompt(
  params: Pick<GenerateBookParams, 'title' | 'theme' | 'context_type' | 'age_range' | 'language' | 'difficulty' | 'num_sections' | 'content_mix' | 'map_style' | 'address_form'> & { synopsis?: string; book_summary?: string },
  npcNames: string[],
  locationNames: string[],
  fromSection: number,
  toSection: number,
  totalSections: number,
  isLastBatch: boolean,
  previousSummaries: string[] = [],
  act?: { title: string; synopsis: string; actNumber: number },
  corrections?: string,
  seriesBible?: string | null,
  itemCatalogue?: Array<{ id: string; name: string; category: string; pickup_section_numbers: number[]; use_section_numbers: number[] }>
): string {
  const withMap = !!params.map_style
  const isTu = params.address_form === 'tu'
  const mix = params.content_mix ?? { combat: 20, chance: 10, enigme: 10, magie: 5 }
  const diffLabel = { facile: 'Facile', normal: 'Normal', difficile: 'Difficile', expert: 'Expert' }[params.difficulty]

  const toCount = (pct: number) => Math.max(1, Math.round((pct / 100) * totalSections))
  const batchSize = toSection - fromSection + 1
  const batchRatio = batchSize / totalSections
  const combatInBatch  = Math.max(0, Math.round(toCount(mix.combat)  * batchRatio))
  const chanceInBatch  = Math.max(0, Math.round(toCount(mix.chance)  * batchRatio))
  const enigmeInBatch  = Math.max(0, Math.round(toCount(mix.enigme)  * batchRatio))
  const magieInBatch   = Math.max(0, Math.round(toCount(mix.magie)   * batchRatio))

  const narrative = params.synopsis?.trim() || params.book_summary?.trim() || ''

  return `Tu génères un lot de sections pour le livre DYEH "${params.title}" (${params.theme}, ${params.context_type}, ${params.age_range} ans).
Adresse : ${isTu ? 'tutoiement ("tu")' : 'vouvoiement ("vous")'} — Difficulté : ${diffLabel}
${seriesBible ? `\nBIBLE DE LA SÉRIE (contexte global à respecter) :\n${seriesBible.slice(0, 1500)}\n` : ''}${act
  ? `\n=== ACTE ${act.actNumber} : "${act.title}" ===\n${act.synopsis}\n`
  : narrative ? `\nSynopsis général :\n${narrative.slice(0, 2000)}\n` : ''
}${previousSummaries.length ? `\nContinuité narrative — fin du lot précédent :\n${previousSummaries.join('\n')}\nReprends directement depuis cet état narratif.\n` : ''}${corrections ? `\n⚠ CORRECTIONS OBLIGATOIRES pour ce lot (version précédente rejetée) :\n${corrections}\nCes erreurs structurelles ou narratives ont été identifiées — tu DOIS les corriger dans cette version.\n` : ''}
PNJ disponibles (utilise EXACTEMENT ces noms pour enemy_name) :
${npcNames.join(', ')}
${withMap ? `\nLieux disponibles (utilise EXACTEMENT ces noms pour location_name) :\n${locationNames.join(', ')}\n` : ''}${itemCatalogue && itemCatalogue.length > 0 ? `
Catalogue d'objets (pour items_on_scene et choix verrouillés) :
${itemCatalogue.map(it => `- "${it.name}" [${it.category}] id:${it.id} | pickup:§${it.pickup_section_numbers.join('§,')} | usage:§${it.use_section_numbers.join('§,')}`).join('\n')}

Règles objets :
- Si une section de ce lot figure dans les pickup_section_numbers d'un objet, ajoute cet objet dans items_on_scene de la section : [{"item_id":"<id>"}] (pas de position — elle sera définie manuellement)
- Si une section de ce lot figure dans les use_section_numbers d'un objet, ajoute dans ses choices un choix verrouillé : "condition":{"item_id":"<id>"}, "locked_label":"<texte si objet absent>", "label":"<texte si objet présent>" — ce choix a un target_section normal
- Un objet peut apparaître dans plusieurs sections si plusieurs chemins existent
` : ''}
Génère les sections ${fromSection} à ${toSection} (${batchSize} sections sur ${totalSections} au total).
Répartition cible pour CE lot : ~${combatInBatch} combat, ~${chanceInBatch} chance, ~${enigmeInBatch} énigme/intel, ~${magieInBatch} magie, reste narration.
${isLastBatch ? `\nCe lot contient les DERNIÈRES sections — inclure toutes les fins (victoire et mort) conformément à la difficulté ${diffLabel}.` : `\nCe lot ne contient PAS encore les fins — reserve is_ending:true pour le dernier lot.`}

Règles :
- Section ${fromSection === 1 ? '1 = point de départ de l\'aventure' : `${fromSection} = suite directe des sections précédentes`}
- summary : 1 à 2 phrases (20-30 mots) décrivant l'action et l'enjeu de la scène
- hint : 1 phrase d'aide subtile pour le joueur s'il est bloqué — oriente sans révéler (ex: "Certains objets ramassés plus tôt pourraient s'avérer utiles ici." ou "Observer l'environnement attentivement révèle parfois ce que les apparences cachent."). Ne jamais donner la solution directement.
- INTERDIT : deux sections combat consécutives dans le même chemin
- Tout trial DOIT avoir success_section ET failure_section pointant vers des sections de CE lot ou des lots précédents (${1} à ${toSection})
- OBLIGATOIRE : toute épreuve de combat (type "combat") DOIT avoir enemy_name avec le nom EXACT d'un PNJ de la liste ci-dessus. Sans enemy_name, le combat est invalide.
- RÈGLE CRITIQUE — failure_section des combats : l'échec d'un combat NE MÈNE PAS à une fin mort sauf cas exceptionnel (boss final, piège mortel). Dans la grande majorité des cas, failure_section pointe vers une section narrative de conséquence (fuite, blessure, capture, repli, humiliation). Les fins mort (is_ending:true, ending_type:"death") sont réservées aux fins du livre conformément au guide de difficulté — pas aux défaites intermédiaires.
- is_back:true autorisé sur ~15% des sections de narration (retour vers section déjà vue)
${withMap ? '- location_name doit correspondre exactement à l\'un des lieux listés ci-dessus' : ''}
- Nombre de choix : la plupart des sections ont 2 choix. Aux carrefours narratifs importants (dilemme moral, croisement de chemins, interrogatoire), utilise 3 choix. Ne dépasse jamais 3.
- Label de choix : COURT, 3 à 5 mots maximum, commençant par un verbe à l'infinitif. Exemples valides : "Explorer le parc", "S'enfuir dans la rue", "Parler au garde", "Forcer la serrure". INTERDIT : phrases longues, subordonnées, explications ("Décider de partir car il est dangereux de rester" est invalide).
- Scènes d'interrogatoire (Q&A mémoriel) : quand un PNJ pose une question au héros, les choix sont les RÉPONSES possibles du héros (ex : "Je mens et dis que...", "Je réponds honnêtement...", "Je refuse de répondre"). Les sections cibles divergent SELON la réponse donnée — dans chaque section cible, le PNJ doit réagir en fonction de la réponse reçue (il s'en souvient). Ce pattern est distinct d'un trial : il n'y a pas de jet de dé, juste un choix de réponse avec conséquences narratives.

Réponds UNIQUEMENT avec du JSON brut valide, sans bloc markdown :
{ "sections": [
  {
    "number": ${fromSection},
    "summary": "...",
    "hint": "Certaines portes ne s'ouvrent qu'avec les bons mots.",
    "is_ending": false,
    "ending_type": null,
    "trial": null,${withMap ? `\n    "location_name": "...",` : ''}
    "items_on_scene": [],
    "choices": [
      { "label": "...", "target_section": ${fromSection + 1}, "sort_order": 0 },
      { "label": "Utiliser la clef pour ouvrir la porte", "locked_label": "Cette porte nécessite quelque chose…", "condition": { "item_id": "<id>" }, "target_section": ${fromSection + 2}, "sort_order": 1 }
    ]
  },
  {
    "number": ${fromSection + 1},
    "summary": "...",
    "hint": "Vos alliés pourraient peut-être vous aider dans cette situation.",
    "is_ending": false,
    "ending_type": null,
    "trial": {
      "type": "combat",
      "stat": "force",
      "enemy_name": "${npcNames[0] ?? 'Nom du PNJ'}",
      "success_section": ${fromSection + 2},
      "failure_section": ${fromSection + 3},
      "xp_reward": 75,
      "endurance_loss_on_failure": 3
    },${withMap ? `\n    "location_name": "...",` : ''}
    "choices": []
  }
]}`
}

// ── Phase 2 : génération du contenu narratif ─────────────────────────────────

export interface SectionMeta {
  number: number
  summary: string
  type: string        // 'Narration' | 'Combat' | 'Victoire' | 'Mort' | etc.
  location?: string
  choiceLabels: string[]
  choices?: { label: string; target: number | null }[]
  trialTargets?: { success: number | null; failure: number | null }
  narrativeArc?: NarrativeArc | null
}

export function buildSectionContentPrompt(
  params: GenerateBookParams,
  sections: SectionMeta[],
  npcs: { name: string; speech_style?: string | null; type?: string }[] = []
): string {
  const lang = params.language === 'fr' ? 'français' : 'anglais'
  const isTu = params.address_form === 'tu'
  const addressNote = isTu
    ? '- Écriture à la 2ème personne du singulier TUTOIEMENT ("Tu avances...", "Tu sens...", "Tu vois...") — utiliser systématiquement "tu" et jamais "vous"'
    : '- Écriture à la 2ème personne du singulier VOUVOIEMENT ("Vous avancez...", "Vous sentez...", "Vous voyez...") — utiliser systématiquement "vous" et jamais "tu"'

  const sectionList = sections.map(s => {
    const loc  = s.location ? ` — Lieu : ${s.location}` : ''
    const ends = s.type === 'Victoire' ? ' [FIN VICTOIRE]' : s.type === 'Mort' ? ' [FIN MORT]' : ''
    const isTrialType = ['Combat', 'Chance', 'Magie', 'Agilité', 'Énigme', 'Crochetage', 'Dialogue'].includes(s.type)
    const isEnding = s.type === 'Victoire' || s.type === 'Mort'

    // Phrases de transition à inclure à la fin du texte
    let transition = ''
    if (isEnding) {
      transition = `FIN [${s.type}] — Rédige 60-100 mots. Conclusion ${s.type === 'Victoire' ? 'triomphante' : 'tragique'}. Pas de phrase de transition — c'est la fin.`
    } else if (isTrialType && s.trialTargets) {
      const suc = s.trialTargets.success ? `§${s.trialTargets.success}` : '?'
      const fai = s.trialTargets.failure ? `§${s.trialTargets.failure}` : '?'
      transition = `ÉPREUVE [${s.type}] — Rédige 120-180 mots. Termine en suspension juste AVANT l'issue. Inclure obligatoirement à la toute fin du texte :\n"Si vous réussissez, rendez-vous à la section ${suc}.\nSi vous échouez, rendez-vous à la section ${fai}."`
    } else if (isTrialType) {
      transition = `ÉPREUVE [${s.type}] — Rédige 120-180 mots. Termine en suspension juste AVANT l'issue. Crée la tension maximale.`
    } else if (s.choices && s.choices.some(c => c.target !== null)) {
      const lines = s.choices
        .filter(c => c.target !== null)
        .map(c => `• ${c.label} → rendez-vous à la section §${c.target}`)
      transition = `Phrases de transition à inclure à la fin du texte (une par choix) :\n${lines.join('\n')}`
    } else if (s.choiceLabels.length) {
      transition = `Choix disponibles (sans numéros de section connus) : ${s.choiceLabels.map(l => `"${l}"`).join(', ')}`
    } else {
      transition = '(section sans choix ni épreuve — rédige normalement, pas de phrase de transition)'
    }

    const arc = s.narrativeArc ? `\nDirectives narratives Truby :
- Besoin profond du héros : ${s.narrativeArc.need}
- Désir dans cette scène : ${s.narrativeArc.desire}
- Enjeu : ${s.narrativeArc.stake}
- Arc émotionnel : entrée="${s.narrativeArc.emotional_arc.entry}" → sortie="${s.narrativeArc.emotional_arc.exit}"` : ''
    return `§§${s.number}§§ [${s.type}${ends}]${loc} — Résumé : "${s.summary}"${arc}\n${transition}`
  }).join('\n\n')

  return `Tu es un auteur de livres "Dont Vous Êtes le Héros".

Livre : "${params.title}" — Thème : ${params.theme} — Ambiance : ${params.context_type} — Public : ${params.age_range} ans — Langue : ${lang}
${params.synopsis?.trim() ? `
--- SYNOPSIS (feuille de route narrative — respecte scrupuleusement l'arc, l'atmosphère et les dénouements décrits) ---
${params.synopsis.trim()}
---
` : params.description?.trim() ? `\nContexte fourni par l'auteur :\n${params.description.trim()}\n` : ''}
${params.age_range === '18+' ? `
⚠ PUBLIC ADULTE (18+) — DIRECTIVES DE CONTENU MATURE :
- Les scènes de violence peuvent être crues, viscérales et explicites : sang, blessures, mort décrite avec précision, brutalité réaliste
- Pas de filtre ni d'euphémisme pour les combats, tortures, mort de personnages — montre-le tel quel
- Les dialogues peuvent contenir des grossièretés, de l'argot, des insultes — si ça correspond au personnage
- Les émotions extrêmes (haine, désespoir, rage) peuvent être décrites sans atténuation
- Reste cohérent avec le thème et l'univers — la violence doit servir la narration, pas être gratuite
` : params.age_range === '13-17' ? `
Public adolescent (13-17) : violence modérée acceptée (combats, blessures évoquées), tension psychologique forte. Pas de contenu explicitement gore ni sexuel.
` : `
Public enfant (8-12) : violence très atténuée, sans sang ni mort explicite. Ton aventureux et positif.
`}${npcs.length > 0 ? `
PNJ de l'histoire — styles de dialogue à respecter IMPÉRATIVEMENT dans leurs répliques :
${npcs.filter(n => n.speech_style).map(n => `- ${n.name} (${n.type ?? 'PNJ'}) : ${n.speech_style}`).join('\n')}
Quand un de ces personnages parle, son dialogue doit refléter fidèlement son style : accent, vocabulaire, tics de langage, niveau de langue.
` : ''}
Directives d'écriture :
- ${addressNote.replace('- ', '')}
- Adapte le rythme à chaque scène : phrases courtes et percutantes dans l'action, plus amples et sensorielles dans l'exploration ou l'émotion
- Soigne l'atmosphère : sons, odeurs, lumières, textures, sensations intérieures du héros
- Laisse respirer les scènes importantes — une section de combat intense peut être courte, une révélation narrative mérite plus de profondeur
- Les fins (victoire ou mort) doivent être mémorables : trouve le ton juste — triomphant, tragique, poétique, brutal — selon ce que la scène exige
- Cohérence absolue avec l'univers, le thème et le public cible
- Longueur cible par section : 120 à 200 mots pour les narrations et combats, 80 à 120 mots pour les fins et issues d'épreuve. Pas de rembourrage — chaque mot doit servir
- Les phrases de transition ("rendez-vous à la section §X") sont indiquées dans les instructions de chaque section — inclus-les exactement comme spécifié, à la toute fin du texte narratif
- Sections à 3 choix : si une section a 3 choix, c'est un carrefour narratif important — la scène doit mettre en valeur l'ambiguïté ou la richesse des options (dilemme moral, situation complexe, croisement de destins)
- Scènes d'interrogatoire (Q&A mémoriel) : quand les choix disponibles sont des RÉPONSES à une question posée par un PNJ (libellé du choix commence par "Je réponds...", "Je mens...", "Je refuse...", etc.), le texte de la section doit se terminer sur la question explicite du PNJ. Ne révèle pas la réaction du PNJ — elle sera dans la section cible. Dans les sections cibles, le PNJ réagit EXPLICITEMENT à la réponse reçue ("Suite à ta réponse, il durcit le ton...", "Visiblement convaincu par ce que tu viens de dire, il...")
- **Dialogues** : chaque réplique commence par un tiret cadratin (—) suivi d'une espace, conformément à la typographie française. Ex : « — Suis-moi, ordonne-t-il. » Jamais de guillemets droits ("...") pour les dialogues.
- **Show, don't tell** : ne dis jamais "il avait peur" → montre les mains qui tremblent, la gorge serrée. Ne dis jamais "il était déterminé" → montre le regard fixe, la mâchoire serrée. Les émotions passent par les gestes, les sensations, les détails concrets. Interdis-toi tout commentaire narrateur sur l'état émotionnel du héros.
- Si des directives narratives Truby sont fournies pour la section, applique-les : fais entrer le héros dans l'état émotionnel d'entrée et sors-le dans l'état de sortie, en faisant vivre son besoin et son désir tout au long de la scène

Écris le texte narratif pour chaque section ci-dessous.
Pour chaque section, ta réponse doit contenir uniquement :
§§{numéro}§§
{texte narratif}

Sections à rédiger :

${sectionList}`
}

// ── Prompts Projet ────────────────────────────────────────────────────────────

export function buildProjectBooksPrompt(project: {
  title: string; theme: string; num_books: number; description?: string
  age_range: string; context_type: string; language: string; difficulty: string
}): string {
  const lang = project.language === 'fr' ? 'français' : 'anglais'
  const multi = project.num_books > 1

  return `Tu es un auteur expert de livres-jeux "Dont Vous Êtes le Héros" et de séries narratives.

${multi ? `Tu dois créer une SÉRIE de ${project.num_books} livres` : 'Tu dois créer UN livre'} dans l'univers suivant :
- Titre de la série : "${project.title}"
- Thème : ${project.theme}
- Ambiance : ${project.context_type}
- Public : ${project.age_range} ans
- Langue : ${lang}
- Difficulté : ${project.difficulty}
${project.description?.trim() ? `\nContexte et inspiration :\n${project.description.trim()}\n` : ''}
${multi ? `RÈGLES pour la série :
- Chaque livre est AUTONOME (jouable seul) mais partage l'univers et des personnages récurrents
- Les livres forment une progression narrative cohérente : les enjeux s'amplifient d'un tome à l'autre
- Les personnages évoluent entre les tomes (sans que le lecteur soit obligé d'avoir lu les précédents)
- Gradation de la difficulté et des enjeux du tome 1 au tome ${project.num_books}
- Chaque livre a son propre arc narratif complet (début, milieu, fin)` : ''}

Pour chaque livre, produis :
- Un titre accrocheur
- Un résumé complet (400-600 mots) décrivant : le contexte, le héros, l'enjeu principal, les grandes bifurcations narratives possibles, les personnages clés, les lieux, les fins possibles (victoire/mort)${multi ? '\n- La place du livre dans la série et ses liens avec les autres tomes' : ''}

IMPORTANT : ta réponse doit être du JSON brut valide, commençant par [ et finissant par ].
[
  {
    "order_in_series": 1,
    "title": "Titre du livre",
    "book_summary": "Résumé complet..."${multi ? ',\n    "series_link": "Comment ce tome s\'inscrit dans la série..."' : ''}
  }${project.num_books > 1 ? ',\n  { "order_in_series": 2, "title": "...", "book_summary": "...", "series_link": "..." }' : ''}
]`
}

export function buildSeriesAnalysisPrompt(project: Pick<Project, 'title' | 'theme'>, books: Pick<Book, 'order_in_series' | 'title' | 'book_summary'>[]): string {
  const booksList = books
    .sort((a, b) => (a.order_in_series ?? 0) - (b.order_in_series ?? 0))
    .map(b => `### Tome ${b.order_in_series} : "${b.title}"\n${b.book_summary ?? '(pas de résumé)'}`)
    .join('\n\n')

  return `Tu es un éditeur littéraire expert en séries narratives et livres-jeux.

Série : "${project.title}" — ${project.theme}
${books.length === 1 ? 'Livre unique (pas de contrainte de série).' : `${books.length} tomes à analyser.`}

${booksList}

Produis un RAPPORT D'ANALYSE DE COHÉRENCE structuré en markdown :

## Cohérence narrative${books.length > 1 ? ' de la série' : ''}
${books.length > 1 ? '(Les arcs narratifs se suivent-ils logiquement ? Les enjeux progressent-ils ?)' : '(L\'arc narratif est-il complet et cohérent ?)'}

## Personnages et univers
(Cohérence des personnages, de l'univers, du lore entre les tomes)

## Problèmes détectés
(Contradictions, incohérences, trous narratifs — cite les tomes concernés. Si rien : "Aucun problème détecté.")

## Points forts
(Ce qui fonctionne bien)

## Recommandations avant génération des sections
(Maximum 5 suggestions concrètes, triées par priorité)`
}

export function buildSectionStructurePrompt(
  book: Pick<Book, 'title' | 'theme' | 'book_summary' | 'order_in_series'> & {
    age_range: string; context_type: string; language: string; difficulty: string
    num_sections: number; content_mix: any; map_style?: string | null; address_form?: string
    description?: string; map_visibility?: string
  },
  seriesBible?: string | null
): string {
  const params = book as any
  // Réutilise buildBookStructurePrompt mais avec le book_summary comme contexte fort
  // et ajoute le champ narrative_arc dans chaque section
  const basePrompt = buildBookStructurePrompt({
    ...params,
    title: book.title,
    description: [
      book.book_summary ? `RÉSUMÉ DU LIVRE (à respecter scrupuleusement) :\n${book.book_summary}` : '',
      seriesBible ? `BIBLE DE LA SÉRIE (contexte global) :\n${seriesBible.slice(0, 2000)}` : '',
      book.description ?? '',
    ].filter(Boolean).join('\n\n'),
  })

  // Injecter les règles narrative_arc dans le prompt
  return basePrompt.replace(
    'Règles pour les sections :',
    `Règles supplémentaires — Structure narrative Truby :
- Pour chaque section NON-FIN, ajoute un champ "narrative_arc" avec :
  - "need" : le besoin profond du héros dans cette section (sa faille, ce dont il a besoin pour grandir)
  - "desire" : ce qu'il veut concrètement obtenir dans CETTE scène précise
  - "stake" : ce qu'il risque de perdre si il échoue (enjeu concret)
  - "emotional_arc" : { "entry": "état émotionnel en début de section", "exit": "état émotionnel en fin de section" }
- Pour les fins (victoire/mort), narrative_arc peut être null
- L'arc émotionnel doit ÉVOLUER d'une section à l'autre de façon cohérente

Règles pour les sections :`
  ).replace(
    '"choices": [\n        { "label": "...", "target_section": 2, "sort_order": 0 },',
    '"narrative_arc": { "need": "Surmonter sa peur de l\'abandon", "desire": "Trouver une sortie avant l\'aube", "stake": "Ses alliés mourront s\'il échoue", "emotional_arc": { "entry": "Paniqué", "exit": "Déterminé" } },\n      "choices": [\n        { "label": "...", "target_section": 2, "sort_order": 0 },'
  )
}

export function buildSectionAnalysisPrompt(
  book: Pick<Book, 'title' | 'theme' | 'book_summary'>,
  sections: (Pick<Section, 'number' | 'summary' | 'narrative_arc' | 'is_ending' | 'ending_type'> & { id: string })[],
  choices: Pick<Choice, 'section_id' | 'label' | 'target_section_id'>[]
): string {
  const sectionNumberById = new Map(sections.map(s => [s.id, s.number]))

  const sectionLines = sections
    .sort((a, b) => a.number - b.number)
    .map(s => {
      const arc = s.narrative_arc
      const sChoices = choices.filter(c => c.section_id === s.id)
      const ending = s.is_ending ? ` [FIN ${s.ending_type === 'victory' ? 'VICTOIRE' : 'MORT'}]` : ''
      const arcStr = arc ? `\n  Arc Truby: besoin="${arc.need}" | désir="${arc.desire}" | enjeu="${arc.stake}" | émotions: ${arc.emotional_arc.entry} → ${arc.emotional_arc.exit}` : ''
      const choiceStr = sChoices.length
        ? '\n  Choix: ' + sChoices.map(c => {
            const tNum = c.target_section_id ? sectionNumberById.get(c.target_section_id) : null
            return `"${c.label}"${tNum ? ` → §${tNum}` : ' (fin)'}`
          }).join(' | ')
        : ''
      return `§${s.number}${ending} — ${s.summary ?? '(pas de résumé)'}${arcStr}${choiceStr}`
    }).join('\n\n')

  return `Tu es un éditeur littéraire expert en structure narrative (méthode John Truby).

Livre : "${book.title}" — ${book.theme}
${book.book_summary ? `Résumé du livre : ${book.book_summary.slice(0, 400)}` : ''}

--- STRUCTURE DES SECTIONS ---
${sectionLines}
--- FIN ---

Produis un RAPPORT D'ANALYSE DE COHÉRENCE NARRATIVE structuré en markdown :

## Cohérence des arcs Truby
(Les besoins/désirs/enjeux évoluent-ils logiquement d'une section à l'autre ? Le héros se transforme-t-il ? Les arcs émotionnels sont-ils crédibles ?)

## Cohérence structurelle
(Sections orphelines, embranchements cassés, fins manquantes, incohérences de lieux ou de temporalité)

## Problèmes narratifs détectés
(Cite les numéros de section §N. Si rien : "Aucun problème détecté.")

## Points forts de la structure

## Recommandations avant rédaction
(Maximum 5, triées par priorité — modifications concrètes à apporter aux sections avant de lancer Mistral)`
}

// ── Prompts images ────────────────────────────────────────────────────────────

export function buildSectionImagePrompt(
  sectionContent: string,
  theme: string,
  contextType: string,
  ageRange: string
): string {
  const summary = sectionContent.slice(0, 200).replace(/\n/g, ' ')
  const style = ageRange === '8-12'
    ? 'colorful illustration, children book style, safe for kids'
    : ageRange === '13-17'
    ? 'dramatic illustration, fantasy art style, teen adventure'
    : 'cinematic dark fantasy illustration, detailed, atmospheric, mature'

  return `${style}, ${theme} setting, ${contextType} mood. Scene: ${summary}. High quality digital art, no text.`
}
