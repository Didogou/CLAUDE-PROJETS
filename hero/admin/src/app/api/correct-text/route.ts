import { NextRequest, NextResponse } from 'next/server'
import { callMistral } from '@/lib/ai-utils'
import { fixJsonControlChars, extractJson } from '@/lib/ai-utils'

export async function POST(req: NextRequest) {
  const { text } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'Texte vide' }, { status: 400 })

  const system = `Tu es un correcteur orthographique strict pour du texte narratif français.
RÈGLE ABSOLUE pour "corrected" : tu ne changes QUE les fautes d'orthographe et d'accord (genre, nombre, conjugaison). Tu ne modifies JAMAIS le style, le vocabulaire, la formulation, la ponctuation, la structure des phrases, ni l'ordre des mots.
Pour "alternative" : propose une réécriture libre du même passage en améliorant le style, le rythme et la précision narrative, en gardant le même sens et la même longueur approximative.
Tu peux signaler dans "notes" les imprécisions narratives ou faiblesses de style.

Réponds UNIQUEMENT en JSON strict, sans aucun texte avant ou après :
{
  "corrected": "texte original avec fautes d'orthographe corrigées uniquement",
  "alternative": "réécriture libre et améliorée du même passage",
  "notes": [
    "⚠️ [Imprécision] ...",
    "✏️ [Style] ..."
  ]
}
Si aucune note, "notes" est un tableau vide [].`

  const raw = await callMistral(system, text, Math.max(1024, text.length * 3))

  try {
    const jsonStr = extractJson(raw) ?? raw
    const parsed = JSON.parse(fixJsonControlChars(jsonStr))
    return NextResponse.json({
      corrected: parsed.corrected ?? text,
      alternative: parsed.alternative ?? null,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    })
  } catch {
    // Fallback si Mistral ne retourne pas de JSON valide
    return NextResponse.json({ corrected: raw.trim(), notes: [] })
  }
}
