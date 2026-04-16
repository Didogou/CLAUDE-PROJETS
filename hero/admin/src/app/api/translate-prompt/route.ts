import { NextRequest, NextResponse } from 'next/server'
import { anthropic } from '@/lib/ai-utils'

export const maxDuration = 30

const SDXL_PROMPT_RULES = `You are an expert Stable Diffusion XL prompt engineer. Convert the user's French image description into an optimized SDXL prompt in English.

## STRICT RULES — follow ALL of them:

1. STRUCTURE: Subject → Pose/Action → Clothing → Setting → Lighting → Camera → Style
2. LENGTH: 30-75 tokens ideal. The first 5-10 words determine 70% of the image.
3. NATURAL LANGUAGE: Write descriptive sentences, NOT comma-separated tag lists.
4. BREAK: Use BREAK to separate distinct concepts (characters BREAK setting BREAK style).
5. WEIGHTING: Use (word:1.2) sparingly — max 1.4, max 2-3 weighted elements.
6. NO face descriptions when the prompt mentions IPAdapter or character reference — faces are handled by the reference image.
7. QUALITY BOOSTERS that work: cinematic lighting, volumetric lighting, rim light, 85mm lens, shallow depth of field, film grain.
8. DO NOT use: masterpiece, best quality, 8k, uhd, trending on artstation, award winning — these are useless on SDXL.
9. NEGATIVE PROMPT: Always short — "low quality, blurry, distorted, watermark, text, deformed hands"
10. NO redundancy — don't repeat concepts. "cinematic" once is enough.

## OUTPUT FORMAT:
Return ONLY a JSON object with two fields:
{
  "positive": "the optimized English prompt",
  "negative": "short negative prompt"
}

Do NOT include any explanation, markdown, or extra text.`

export async function POST(req: NextRequest) {
  try {
    const { prompt_fr, has_ipadapter, is_portrait } = await req.json() as {
      prompt_fr: string
      has_ipadapter?: boolean
      is_portrait?: boolean
    }

    if (!prompt_fr?.trim()) {
      return NextResponse.json({ error: 'prompt_fr requis' }, { status: 400 })
    }

    const extraRule = [
      has_ipadapter ? 'This prompt will be used with IPAdapter FaceID (character reference image). Do NOT describe facial features, eye color, skin tone, or ethnicity — the reference image handles all of that. Focus on pose, clothing, setting, lighting, and style.' : '',
      is_portrait ? 'This is a CHARACTER REFERENCE PORTRAIT for IPAdapter. The output MUST be: close-up bust portrait, head and shoulders ONLY, centered face looking at camera, plain neutral gray background, soft studio lighting. Do NOT include legs, feet, full body, sitting, crouching. Do NOT describe shoes/sneakers/pants in detail — only mention upper body clothing visible in a bust shot. The face must occupy 60-70% of the image.' : '',
    ].filter(Boolean).join('\n\n')

    const extraRuleBlock = extraRule ? `\n\nIMPORTANT:\n${extraRule}` : ''

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `${SDXL_PROMPT_RULES}${extraRuleBlock}\n\nFrench description to convert:\n${prompt_fr}`,
      }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Réponse AI invalide', raw: text }, { status: 500 })
    }

    const parsed = JSON.parse(jsonMatch[0]) as { positive: string; negative: string }

    return NextResponse.json({
      prompt_en: parsed.positive,
      negative_prompt: parsed.negative,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
