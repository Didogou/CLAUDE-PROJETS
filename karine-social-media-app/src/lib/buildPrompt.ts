import { CHARTE, SAISON_ACTUELLE } from "./prompts";

export function buildMenuPrompt(theme?: string): string {
  return `${CHARTE}

TÂCHE : Génère le menu des dîners de la semaine pour Karine Piffaretti.
Saison actuelle : ${SAISON_ACTUELLE()}
${theme ? `Thème ou contrainte spéciale : ${theme}` : ""}

CONTRAINTES OBLIGATOIRES :
- 7 dîners (lundi au dimanche)
- Recettes de saison (${SAISON_ACTUELLE()})
- Temps de préparation < 30 minutes
- Budget raisonnable
- Protéines variées sur la semaine : poisson, viande blanche, viande rouge, légumineuses, œufs
- Équilibre diététique sans extrême (plaisir + santé)
- Pour chaque recette : liste complète des ingrédients avec grammages et mesures (pour 2 personnes)

PRÉSENTE LE RÉSULTAT ainsi :

**MENU DE LA SEMAINE**

**Lundi** — [Nom du plat] (⏱ XX min · protéine : [type])
Ingrédients : [liste avec grammages]
Préparation : [2-3 étapes courtes]

[...répète pour chaque jour...]

**POST INSTAGRAM DU DIMANCHE :**
[Légende complète avec emojis et hashtags, ton bienveillant de Karine]

**ACCROCHE VISUEL :**
[Phrase courte pour le visuel]`;
}

export function buildRecettePrompt(description: string, nom?: string, ingredients?: string): string {
  return `${CHARTE}

TÂCHE : Génère le post Instagram/Facebook pour la recette du jour de Karine Piffaretti.
Description du plat : ${description}
${nom ? `Nom du plat : ${nom}` : ""}
${ingredients ? `Ingrédients principaux : ${ingredients}` : ""}

PRÉSENTE LE RÉSULTAT ainsi :

**TITRE VISUEL :** [Titre court, max 6 mots]

**BIENFAITS :** [3 bienfaits nutritionnels clés]

**LÉGENDE INSTAGRAM/FACEBOOK :**
[Légende complète 80-150 mots, vouvoiement, emojis, appel à la communauté]

**HASHTAGS :**
[liste des hashtags]`;
}

export function buildConseilPrompt(theme?: string): string {
  return `${CHARTE}

TÂCHE : Génère un post conseil diététique pour Karine Piffaretti.
Thème : ${theme || "choisis le sujet le plus pertinent pour la saison " + SAISON_ACTUELLE()}
Saison actuelle : ${SAISON_ACTUELLE()}

PRÉSENTE LE RÉSULTAT ainsi :

**TITRE :** [Titre accrocheur, max 10 mots]

**CONSEIL CLÉ :** [Le conseil principal en une phrase]

**POINTS CLÉS :**
• [point 1]
• [point 2]
• [point 3]

**LÉGENDE INSTAGRAM/FACEBOOK :**
[Légende complète 120-200 mots, vouvoiement, pédagogique, emojis, hashtags]

**CALL-TO-ACTION :**
[Question ou invitation à la communauté]`;
}
