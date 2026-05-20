/**
 * POST /api/character/enhance-prompt
 *
 * Aide IA pour enrichir une description visuelle de personnage avant génération
 * portrait (Z-Image / Flux). Reçoit une description courte de l'auteur, renvoie
 * un prompt enrichi couvrant les 4 axes : sujet, vêtement/époque, lumière,
 * ambiance/mood. Tient compte du style choisi (realistic, dark_fantasy, etc.)
 * pour adapter le vocabulaire.
 *
 * Refonte 2026-05-19 — V1. Mistral (rapide, FR/EN natif).
 */

import { NextRequest, NextResponse } from 'next/server'
import { callMistral } from '@/lib/ai-utils'

interface EnhanceBody {
  rawPrompt: string
  /** Style cible parmi CharacterStyle. Adapte le vocabulaire IA. */
  style?: string | null
  /** Type NPC (allié, ennemi, boss, marchand, neutre) pour adapter le mood. */
  npcType?: string | null
  /** Nom du perso (pour personnaliser). Optionnel. */
  name?: string | null
}

/** Mapping style → consignes spécifiques (mots-clés pivot). */
const STYLE_HINTS: Record<string, string> = {
  realistic: 'photographie réaliste, lentille 85mm, lumière naturelle, profondeur de champ, texture de peau visible',
  anime_modern: 'film d\'animation moderne style Ghibli ou Makoto Shinkai, cel-shading doux, fond pictural',
  manga: 'style manga shōnen, traits encrés appuyés, expression dynamique, halftone',
  bd: 'bande dessinée franco-belge ligne claire, couleurs plates, style Tintin Astérix',
  comic: 'comic book américain, encrage net, couleurs saturées, style Marvel DC moderne',
  concept_art: 'concept art jeu vidéo, peinture cinématique, esthétique Dishonored Diablo',
  dark_fantasy: 'peinture dark fantasy à l\'huile, chiaroscuro dramatique, palette désaturée, Frazetta et Brom, ambiance Souls',
}

const SYSTEM_PROMPT = `Tu es un expert en prompting d'image générative (Flux, Z-Image, SDXL). Ton rôle : transformer une description courte d'un auteur en un prompt riche pour générer un portrait de personnage de qualité cinéma.

RÈGLES STRICTES :
1. Tu réponds UNIQUEMENT par le prompt enrichi, sans préambule, sans explication, sans guillemets.
2. Tu écris en français, sous forme d'une seule phrase descriptive fluide.
3. Tu couvres les 4 axes :
   - SUJET : âge approximatif, genre, traits distinctifs visibles
   - VÊTEMENT + ÉPOQUE : matière, couleur, coupe, accessoires
   - LUMIÈRE : type d'éclairage (rembrandt, fenêtre douce, contre-jour, ambient, golden hour…)
   - AMBIANCE/MOOD : émotion dégagée, atmosphère (film noir, mélancolique, héroïque…)
4. Tu RESPECTES le style demandé (le mot-clé STYLE en input) et l'intègres au vocabulaire.
5. Tu RESTES fidèle à la description de l'auteur — n'ajoute pas d'éléments qui contredisent (ex: si l'auteur dit "jeune femme", ne mets pas "vieillard").
6. Pas de "headshot", "portrait", "8K", "trending on artstation" — Hero ajoute ces tokens automatiquement en aval.
7. Maximum 60 mots.

EXEMPLES :
INPUT : "Un détective sombre"
STYLE : dark_fantasy
OUTPUT : Homme dans la quarantaine, traits ciselés, regard perçant et fatigué, manteau de cuir usé sur chemise grise, écharpe sombre, éclairage rembrandt latéral sculptant le visage, atmosphère film noir, ombres profondes, palette désaturée tirant vers le bleu nuit, posture droite, mood mélancolique et déterminé.

INPUT : "Jeune fille elfe blonde"
STYLE : anime_modern
OUTPUT : Jeune femme elfe d'une vingtaine d'années, cheveux blonds longs et tressés, oreilles pointues délicates, yeux verts lumineux, robe de lin clair brodée, lumière matinale dorée filtrant à travers les feuilles, ambiance paisible et féérique, sourire serein.`

export async function POST(req: NextRequest) {
  let body: EnhanceBody
  try {
    body = await req.json() as EnhanceBody
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 })
  }

  const raw = (body.rawPrompt ?? '').trim()
  if (!raw) {
    return NextResponse.json({ error: 'rawPrompt requis' }, { status: 400 })
  }
  if (raw.length > 1000) {
    return NextResponse.json({ error: 'rawPrompt trop long (max 1000 caractères)' }, { status: 400 })
  }

  const style = body.style ?? 'realistic'
  const styleHint = STYLE_HINTS[style] ?? STYLE_HINTS.realistic
  const npcType = body.npcType ?? null
  const name = (body.name ?? '').trim()

  const userPrompt = [
    `STYLE : ${style} (= ${styleHint})`,
    npcType ? `TYPE : ${npcType}` : null,
    name ? `NOM : ${name}` : null,
    `INPUT : ${raw}`,
    'OUTPUT :',
  ].filter(Boolean).join('\n')

  try {
    // Mistral max 220 tokens = environ 150-180 mots français = large pour 60 mots cibles.
    const raw = await callMistral(SYSTEM_PROMPT, userPrompt, 220)
    const enhanced = raw.trim()
      .replace(/^["'`]+|["'`]+$/g, '')        // strip guillemets éventuels
      .replace(/^output\s*:\s*/i, '')          // strip "OUTPUT :" leftover
      .trim()
    if (!enhanced) {
      return NextResponse.json({ error: 'Mistral a renvoyé une réponse vide' }, { status: 502 })
    }
    return NextResponse.json({ enhancedPrompt: enhanced })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[enhance-prompt] Mistral failed:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
