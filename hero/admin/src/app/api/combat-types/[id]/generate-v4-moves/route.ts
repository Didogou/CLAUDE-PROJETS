import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { anthropic } from '@/lib/ai-utils'

export const maxDuration = 120

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: combatTypeId } = await params

  // Récupérer le type de combat + ses moves existants
  const { data: ct, error: ctErr } = await supabaseAdmin
    .from('combat_types')
    .select('*, combat_moves(*)')
    .eq('id', combatTypeId)
    .single()

  if (ctErr || !ct) return NextResponse.json({ error: 'Type de combat introuvable' }, { status: 404 })

  const existingMoves = (ct.combat_moves ?? []) as any[]
  const standardAttacks = existingMoves.filter((m: any) => !m.is_parry && (m.move_type === 'attack' || !m.move_type))

  if (standardAttacks.length === 0) {
    return NextResponse.json({ error: 'Aucune attaque standard trouvée. Créez d\'abord des attaques.' }, { status: 400 })
  }

  const prompt = `Tu génères les données de combat V4 pour un jeu de type LDVELH (Livre Dont Vous Êtes le Héros) en français.

Type de combat : "${ct.name}" (${ct.type === 'rue' ? 'bagarre de rue' : ct.type === 'coup_de_feu' ? 'armes à feu' : 'attaque surprise'})
${ct.description ? `Description : ${ct.description}` : ''}

Attaques standard existantes :
${standardAttacks.map((m: any, i: number) => `${i + 1}. "${m.name}" — dégâts: ${m.damage}, bonus/malus: ${m.bonus_malus}`).join('\n')}

Ta mission :

**1. Pour chaque attaque standard**, définis :
- \`creates_state\` : l'état physique créé sur la cible si le coup réusit. Choisis parmi : stunned, bent_low, off_balance, backed_up, grounded, fleeing, ou null si le coup ne crée pas d'état particulier.
- \`narrative_on_hit\` : texte narratif court (max 8 mots) décrivant l'effet. Ex: "Il se plie en deux, sonné."
- \`narrative_on_miss\` : texte narratif court si raté. Ex: "Il esquive d'un pas de côté."

**2. Pour chaque état créé** (max 1 set de 3 moves par état unique), génère **3 moves de suivi contextuels** :
- \`move_type\` = "contextual"
- \`required_state\` = l'état concerné
- Nom court et évocateur (max 4 mots), adapté à la posture de l'adversaire
- \`damage\` : légèrement plus élevé (état vulnérable = avantage), 1-5
- \`bonus_malus\` : 0 à +2 (avantage situationnel)
- \`narrative_on_hit\` : texte narratif si touché
- \`narrative_on_miss\` : texte narratif si raté

**3. Génère exactement 3 moves de récupération** (\`move_type\` = "recovery", \`required_self_state\` = "grounded") pour quand le joueur est au sol :
- Se relever rapidement (bonus_malus: -1, damage: 0)
- Se relever prudemment (bonus_malus: 0, damage: 0)
- Roulade et contre (bonus_malus: +1, damage: 1)

Réponds UNIQUEMENT en JSON valide, sans markdown, avec cette structure :
{
  "standard_updates": [
    { "id": "...", "creates_state": "...", "narrative_on_hit": "...", "narrative_on_miss": "..." }
  ],
  "new_moves": [
    {
      "name": "...",
      "narrative_text": "...",
      "move_type": "contextual",
      "required_state": "...",
      "bonus_malus": 0,
      "damage": 2,
      "narrative_on_hit": "...",
      "narrative_on_miss": "...",
      "is_parry": false,
      "is_contextual": true,
      "sort_order": 100
    }
  ]
}`

  let raw = ''
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })
    raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
  } catch (e: any) {
    return NextResponse.json({ error: `Erreur Claude: ${e.message}` }, { status: 500 })
  }

  let parsed: { standard_updates: any[]; new_moves: any[] }
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch?.[0] ?? raw)
  } catch {
    return NextResponse.json({ error: 'Erreur parsing JSON Claude', raw }, { status: 500 })
  }

  const results = { updated: 0, created: 0, errors: [] as string[] }

  // Mettre à jour les moves standard avec creates_state + narratives
  for (const upd of parsed.standard_updates ?? []) {
    const { error } = await supabaseAdmin
      .from('combat_moves')
      .update({
        creates_state: upd.creates_state ?? null,
        narrative_on_hit: upd.narrative_on_hit ?? null,
        narrative_on_miss: upd.narrative_on_miss ?? null,
      })
      .eq('id', upd.id)
    if (error) results.errors.push(`Update ${upd.id}: ${error.message}`)
    else results.updated++
  }

  // Insérer les nouveaux moves (contextuels + recovery)
  for (const mv of parsed.new_moves ?? []) {
    const { error } = await supabaseAdmin
      .from('combat_moves')
      .insert({
        combat_type_id: combatTypeId,
        name: mv.name,
        narrative_text: mv.narrative_text ?? mv.name,
        bonus_malus: mv.bonus_malus ?? 0,
        damage: mv.damage ?? 0,
        is_parry: false,
        is_contextual: true,
        sort_order: mv.sort_order ?? 100,
        move_type: mv.move_type ?? 'contextual',
        required_state: mv.required_state ?? null,
        required_self_state: mv.required_self_state ?? null,
        narrative_on_hit: mv.narrative_on_hit ?? null,
        narrative_on_miss: mv.narrative_on_miss ?? null,
      })
    if (error) results.errors.push(`Insert ${mv.name}: ${error.message}`)
    else results.created++
  }

  // Retourner les moves mis à jour pour rafraîchir l'UI
  const { data: refreshed } = await supabaseAdmin
    .from('combat_moves')
    .select('*')
    .eq('combat_type_id', combatTypeId)
    .order('sort_order')

  return NextResponse.json({ ...results, moves: refreshed ?? [] })
}
