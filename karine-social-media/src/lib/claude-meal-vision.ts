import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

// Sonnet 4.6 : meilleur que Haiku 4.5 sur les images complexes
// (multi-ingredients, eclairage difficile, plats exotiques).
// Surcout marginal (~0.003€/image vs 0.001) acceptable vs precision.
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 400;

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/**
 * Décrit un plat photographié en une phrase française adaptée au
 * pipeline parse de saisie naturelle.
 *
 * Strategie : on demande à Claude Haiku Vision de produire un
 * texte court (1-2 phrases) qui ressemble à ce qu'une abonnée
 * taperait elle-même : "une assiette de salade de tomates avec
 * mozzarella et un verre de vin".
 *
 * Ce texte est ensuite envoyé tel quel au pipeline /api/nutrition
 * /parse qui se charge du reste (Mistral, Ciqual, accompagnements…).
 */
export async function describeMealFromImage(
  imageBuffer: Buffer,
  mediaType: MediaType,
): Promise<string | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    tools: [
      {
        name: 'save_meal_description',
        description:
          "Enregistre la description du repas photographié, prête pour analyse nutritionnelle.",
        input_schema: {
          type: 'object',
          properties: {
            description: {
              type: ['string', 'null'],
              description:
                "Une phrase française naturelle qui décrit ce que l'utilisatrice est en train de manger, en mentionnant les aliments principaux et leurs quantités estimées. Format type 'une assiette de X avec Y et Z, environ N grammes'. null si la photo ne montre pas de nourriture.",
            },
          },
          required: ['description'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'save_meal_description' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBuffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text: `Tu es un assistant nutritionnel. Décris CETTE PHOTO de repas en UNE SEULE phrase française naturelle, comme si l'utilisatrice tapait elle-même ce qu'elle est en train de manger.

Règles :
- Mentionne les aliments principaux et les contenants visibles ("une assiette de", "un bol de", "un verre de").
- Si une taille est visible (petit, grand), précise-la.
- Évite les phrases trop longues ; max 2 phrases courtes.
- N'invente PAS d'aliments invisibles. Si tu as un doute, choisis le terme générique.
- Si la photo ne montre PAS de nourriture (selfie, objet…), renvoie description=null.

Exemples de bons formats :
- "une assiette de salade de tomates avec mozzarella et basilic, environ 200g"
- "un bol de pâtes carbonara, environ 250g"
- "un hamburger avec une portion de frites"
- "un yaourt nature avec quelques fraises"

Appelle save_meal_description.`,
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') return null;
  const input = toolUse.input as Record<string, unknown>;
  if (typeof input.description !== 'string') return null;
  const desc = input.description.trim();
  return desc.length > 0 ? desc : null;
}
