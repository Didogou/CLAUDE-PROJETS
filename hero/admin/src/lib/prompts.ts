import type { GenerateBookParams } from '@/types'

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
  const { title, theme, age_range, context_type, language, num_sections, difficulty, content_mix, map_type } = params
  const lang = language === 'fr' ? 'français' : 'anglais'
  const diffLabel = { facile: 'Facile', normal: 'Normal', difficile: 'Difficile', expert: 'Expert' }[difficulty]
  const weaponGuide = WEAPON_GUIDE[theme] ?? 'Armes cohérentes avec l\'univers du livre.'
  const withMap = map_type !== 'none'

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
- Écriture à la 2ème personne du singulier ("Vous avancez...", "Vous sentez...")
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
- Texte narratif immersif (min. 150 mots) à la 2ème personne
- Chaque section DOIT avoir un champ "summary" : une phrase courte (max 12 mots) résumant l'action clé de la section, ex: "Vous affrontez le garde devant la porte de la tour"
- 0 à 4 choix menant à d'autres sections
- Les épreuves de combat DOIVENT référencer "enemy_name" avec le nom exact d'un PNJ créé ci-dessus
- OBLIGATION : toute section avec un trial DOIT avoir success_section ET failure_section définis
- En cas de victoire : attribuer xp_reward (boss: 150-300 XP, ennemi: 50-100 XP) et item_rewards si l'histoire le permet (tableau de strings, ex: ["Épée +2", "Potion de soin"])
- En cas d'échec : définir endurance_loss_on_failure (dégâts subis) et une section de repli narrative
- Combats magiques (type "magie") : inclure mana_cost (coût en mana du sort lancé, ex: 3)
- Les épreuves non-combat (agilite, intelligence, chance, crochetage) n'ont pas d'enemy_name mais ont obligatoirement success_section et failure_section
- Les sections de type "dialogue" utilisent trial.type = "dialogue" et référencent un PNJ via enemy_name. Elles ont obligatoirement : success_section (joueur convainc/obtient ce qu'il veut), failure_section (joueur échoue ou offense le PNJ), "dialogue_opening" (première réplique du PNJ en restant dans son speech_style), "dialogue_goal" (ce que le joueur doit accomplir dans la conversation, ex: "Convaincre le marchand de vous révéler l'emplacement du temple caché")
- Le nombre de fins victoire et de fins mort doit respecter strictement les proportions indiquées dans le guide de difficulté ci-dessus
- Les embranchements doivent former un arbre cohérent sans sections orphelines

Réponds UNIQUEMENT avec un JSON valide, sans markdown, dans ce format :
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
      "content": "...",
      "is_ending": false,
      "ending_type": null,
      "trial": null,${withMap ? `
      "location_name": "La Taverne du Dragon",` : ''}
      "choices": [
        { "label": "...", "target_section": 2, "sort_order": 0 },
        { "label": "...", "target_section": 5, "sort_order": 1 }
      ]
    },
    {
      "number": 3,
      "content": "...",
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
