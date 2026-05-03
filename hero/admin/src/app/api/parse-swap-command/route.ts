import { NextRequest, NextResponse } from 'next/server'
import { ollamaJSON, isOllamaAvailable } from '@/lib/ollama'

export const maxDuration = 30

/**
 * POST /api/parse-swap-command
 *
 * Body : { command: string }
 *
 * Parse une commande en langage naturel (FR ou EN) décrivant ce que l'auteur
 * veut faire en termes de remplacement de personnage, et retourne les params
 * structurés pour le pipeline character swap :
 *
 *   - mask_keyword : terme EN à passer à Grounded-SAM pour détecter ce qu'il
 *                    faut masquer dans la scène (ex: "man", "person", "chair")
 *   - character_description : prompt de génération SDXL pour créer la ref
 *                    perso (style "fiche perso fond blanc")
 *   - body_prompt : prompt à utiliser pour le KSampler du body swap
 *                    (style + contexte + pose, PAS d'identité)
 *
 * Exemple :
 *   command = "place une elfe blonde sur la chaise à la place de l'homme"
 *   → {
 *       mask_keyword: "man",
 *       character_description: "young blonde elf woman, long flowing blonde hair,
 *                              blue eyes, fair skin, pointed ears, simple medieval
 *                              dress, sitting on a chair, full body shot,
 *                              white background, character reference",
 *       body_prompt: "woman seated on a wooden chair, painterly fantasy illustration,
 *                     warm lighting, detailed background, high quality"
 *     }
 *
 * Provider : Qwen 2.5 (text only, pas vision) via Ollama. Local, gratuit.
 */

interface ParsedCommand {
  mask_keyword: string
  character_description: string
  body_prompt: string
}

const SYSTEM_PROMPT =
  'You are a NLU parser for a character-swap image generation pipeline. ' +
  'You receive a natural language command (French or English) and output ONLY a JSON object with these fields :\n' +
  '{\n' +
  '  "mask_keyword": single English word/short phrase identifying what to remove from the scene (Grounded-SAM accepts "man", "woman", "person", "chair", "dog", etc.). Use the most generic match. Default to "person" if unsure,\n' +
  '  "character_description": English prompt to generate the new character. Describe ONLY identity (race, age, hair color, eye color, skin), clothing, and held props. DO NOT include pose, orientation, or location ("sitting on chair", "standing", "facing camera", "walking" — all forbidden). The pose comes from a separate ControlNet step. End with: "white background, character reference sheet, painterly fantasy illustration",\n' +
  '  "body_prompt": English prompt for the body swap KSampler. Describe ONLY style/lighting/decor context — NOT the character identity, NOT the pose. Ex: "painterly fantasy illustration, warm candlelight, medieval tavern interior, detailed background, high quality"\n' +
  '}\n' +
  'Respond with valid JSON only, no preamble, no markdown wrapping.'

const FEW_SHOT_EXAMPLES =
  'Examples :\n' +
  '\n' +
  'INPUT : "place une elfe blonde sur la chaise à la place de l\'homme"\n' +
  'OUTPUT : {"mask_keyword":"man","character_description":"young elf woman, long flowing blonde hair, blue eyes, fair skin, pointed ears, simple medieval green dress with white sleeves, white background, character reference sheet, painterly fantasy illustration","body_prompt":"painterly fantasy illustration, warm candlelight, medieval tavern interior, detailed background, high quality"}\n' +
  '\n' +
  'INPUT : "remplace le mec par un vieux mage"\n' +
  'OUTPUT : {"mask_keyword":"man","character_description":"old wizard, long white beard, blue robe with silver stars, kind blue eyes, holding a wooden staff, white background, character reference sheet, painterly fantasy illustration","body_prompt":"painterly fantasy illustration, warm lighting, detailed background, high quality"}\n' +
  '\n' +
  'INPUT : "swap the woman cooking with a young blonde elf"\n' +
  'OUTPUT : {"mask_keyword":"woman","character_description":"young elf woman, long flowing blonde hair, blue eyes, fair skin, pointed ears, apron over green dress, white background, character reference sheet, painterly fantasy illustration","body_prompt":"painterly fantasy illustration, warm lighting, detailed background, high quality"}\n' +
  '\n' +
  'INPUT : "mets un orc à la place du voyageur"\n' +
  'OUTPUT : {"mask_keyword":"person","character_description":"fierce orc warrior, green skin, large tusks, scarred face, animal-bone armor, large axe held in hand, muscular build, white background, character reference sheet, painterly fantasy illustration","body_prompt":"painterly fantasy illustration, atmospheric, detailed background, high quality"}\n' +
  '\n' +
  'Now parse the user command :'

export async function POST(req: NextRequest) {
  try {
    const { command } = await req.json() as { command: string }
    if (!command || !command.trim()) {
      return NextResponse.json({ error: 'command requis' }, { status: 400 })
    }

    const ollamaUp = await isOllamaAvailable()
    if (!ollamaUp) {
      return NextResponse.json({ error: 'Ollama non disponible. Lance le service Ollama puis réessaye.' }, { status: 503 })
    }

    const result = await ollamaJSON<ParsedCommand>({
      system: SYSTEM_PROMPT,
      prompt: `${FEW_SHOT_EXAMPLES}\n\nINPUT : "${command.trim()}"\nOUTPUT :`,
      temperature: 0.1,
      timeoutMs: 30_000,
    })

    if (!result.mask_keyword || !result.character_description || !result.body_prompt) {
      return NextResponse.json({ error: 'Missing fields in LLM response', raw: result }, { status: 502 })
    }

    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[parse-swap-command] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
