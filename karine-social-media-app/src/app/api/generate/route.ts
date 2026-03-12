import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { CHARTE, SAISON_ACTUELLE } from "@/lib/prompts";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type, data } = body;

  let prompt = "";

  if (type === "menu") {
    prompt = `
${CHARTE}

TÂCHE : Génère le menu des dîners de la semaine pour Karine Piffaretti.
Saison actuelle : ${SAISON_ACTUELLE()}
${data.theme ? `Thème ou contrainte spéciale : ${data.theme}` : ""}

CONTRAINTES OBLIGATOIRES :
- 7 dîners (lundi au dimanche)
- Recettes de saison (${SAISON_ACTUELLE()})
- Temps de préparation < 30 minutes
- Budget raisonnable
- Protéines variées sur la semaine : poisson, viande blanche, viande rouge, légumineuses, œufs
- Équilibre diététique sans extrême (plaisir + santé)
- Pour chaque recette : liste complète des ingrédients avec grammages et mesures (pour 2 personnes)

RÉPONDS EN JSON avec ce format exact :
{
  "menu": [
    {
      "jour": "Lundi",
      "nom": "Nom du plat",
      "temps": "20 min",
      "proteine": "poulet",
      "ingredients": ["200g de poulet", "2 courgettes", "..."],
      "preparation": "Instructions courtes en 2-3 étapes"
    }
  ],
  "post_instagram": "Légende Instagram pour le post du dimanche annonçant ce menu (avec emojis et hashtags, ton de Karine)",
  "accroche": "Phrase d'accroche courte pour le visuel"
}
`;
  } else if (type === "recette") {
    prompt = `
${CHARTE}

TÂCHE : Génère le post Instagram/Facebook pour la recette du jour de Karine Piffaretti.
Description du plat : ${data.description}
${data.nom ? `Nom du plat : ${data.nom}` : ""}
${data.ingredients ? `Ingrédients principaux : ${data.ingredients}` : ""}

RÉPONDS EN JSON avec ce format exact :
{
  "legende": "Légende complète pour Instagram/Facebook (80-150 mots, vouvoiement, emojis, hashtags)",
  "titre_visuel": "Titre court pour le visuel (max 6 mots)",
  "bienfaits": ["bienfait 1", "bienfait 2", "bienfait 3"],
  "hashtags": ["#hashtag1", "#hashtag2", "..."],
  "call_to_action": "Question ou invitation à la communauté"
}
`;
  } else if (type === "conseil") {
    prompt = `
${CHARTE}

TÂCHE : Génère un post conseil diététique pour Karine Piffaretti.
Thème demandé : ${data.theme || "libre (choisis un sujet pertinent de saison)"}
Saison actuelle : ${SAISON_ACTUELLE()}

THÈMES POSSIBLES : rééquilibrage alimentaire, vitamines et énergie, hydratation,
alimentation anti-inflammatoire, protéines au quotidien, sucres cachés,
gestion des fringales, nutrition sportive, diabète et alimentation,
beauté par l'alimentation, saisonnalité des aliments.

RÉPONDS EN JSON avec ce format exact :
{
  "titre": "Titre accrocheur du conseil (max 10 mots)",
  "legende": "Légende complète Instagram/Facebook (120-200 mots, vouvoiement, pédagogique, emojis, hashtags)",
  "conseil_cle": "Le conseil principal en une phrase",
  "points_cles": ["point 1", "point 2", "point 3"],
  "hashtags": ["#hashtag1", "#hashtag2", "..."],
  "call_to_action": "Question ou invitation à la communauté"
}
`;
  } else {
    return NextResponse.json({ error: "Type inconnu" }, { status: 400 });
  }

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json({ error: "Réponse invalide", raw: text }, { status: 500 });
  }

  const result = JSON.parse(jsonMatch[0]);
  return NextResponse.json(result);
}
