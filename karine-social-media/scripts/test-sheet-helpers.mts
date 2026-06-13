import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = readFileSync('.env.local','utf8')
const g=(k:string)=>env.match(new RegExp(`^${k}="?([^"\\n\\r]+)"?`,'m'))![1]
process.env.ANTHROPIC_API_KEY = g('ANTHROPIC_API_KEY')
process.env.ELEVENLABS_API_KEY = g('ELEVENLABS_API_KEY')
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), {auth:{persistSession:false}}) as any
const { extractPreparationForSheets } = await import('../src/lib/sheet-preparation.ts')
const { generateAudioForSheets } = await import('../src/lib/sheet-audio.ts')
console.log('✅ imports OK')
const REAL = process.argv.includes('--real')
const KARINE_VOICE = 'qldgI4Q7iIA8Jpu0jOvi'
const hasSteps = (v:any)=>Array.isArray(v) && v.length>0

const { data: rs } = await sb.from('recipe_sheets').select('id, preparation_steps').limit(80)
const recipeWithSteps = (rs??[]).find((s:any)=>hasSteps(s.preparation_steps))
const { data: ms } = await sb.from('menu_meal_sheets').select('id, cover_image_url, preparation_steps').limit(80)
const menuNoSteps = (ms??[]).find((s:any)=>!hasSteps(s.preparation_steps) && s.cover_image_url)

// === TEST A : skip logic (déterministe, aucun appel Vision) ===
console.log('\n=== TEST A — skip (skipExisting=true sur fiche AVEC étapes) ===')
if (recipeWithSteps) {
  const r = await extractPreparationForSheets(sb,'recipe_sheets',[{...recipeWithSteps, cover_image_url:''}],true)
  console.log(`recette → ${JSON.stringify(r)}  ${r.skipped===1&&r.updated===0?'✅':'❌'}`)
}

if (!REAL) { console.log('\n→ relance avec --real pour Vision + voix sur une fiche menu'); process.exit(0) }
if (!menuNoSteps) { console.log('aucune fiche menu sans étapes avec image'); process.exit(0) }

// === TEST B : extraction Vision réelle sur fiche MENU ===
console.log(`\n=== TEST B — extract Vision sur menu ${menuNoSteps.id} ===`)
const exR = await extractPreparationForSheets(sb,'menu_meal_sheets',[menuNoSteps],false)
console.log(`résultat: ${JSON.stringify(exR)}`)
const { data: after } = await sb.from('menu_meal_sheets').select('preparation_steps, utensils').eq('id',menuNoSteps.id).single()
const menuSteps = after?.preparation_steps ?? []
console.log(`étapes extraites: ${menuSteps.length}, ustensiles: ${JSON.stringify(after?.utensils)}`)
if (menuSteps[0]) console.log(`  étape[0] menu = ${JSON.stringify(menuSteps[0])}`)
const { data: rfull } = await sb.from('recipe_sheets').select('preparation_steps').eq('id',recipeWithSteps.id).single()
const recipeStep0 = (rfull?.preparation_steps??[])[0]
const keysMenu = menuSteps[0] ? Object.keys(menuSteps[0]).sort() : []
const keysRecipe = recipeStep0 ? Object.keys(recipeStep0).sort() : []
console.log(`\n  clés étape menu   : ${JSON.stringify(keysMenu)}`)
console.log(`  clés étape recette: ${JSON.stringify(keysRecipe)}`)
const sameShape = keysMenu.length>0 && keysMenu.every((k)=>['text','ingredients','utensils','audioUrl'].includes(k))
console.log(`  → structure conforme (text/ingredients/utensils): ${sameShape?'✅':'❌'}`)

// === TEST C : voix réelle sur la fiche menu ===
console.log(`\n=== TEST C — generate-audio sur menu ${menuNoSteps.id} ===`)
const auR = await generateAudioForSheets(sb,'menu_meal_sheets',[{id:menuNoSteps.id, preparation_steps:menuSteps}],KARINE_VOICE,false)
console.log(`résultat: ${JSON.stringify({generated:auR.generated, total:auR.total, errors:auR.errors.length})}`)
const { data: afterAudio } = await sb.from('menu_meal_sheets').select('preparation_steps').eq('id',menuNoSteps.id).single()
const stepsA = afterAudio?.preparation_steps ?? []
const withAudio = stepsA.filter((s:any)=>s.audioUrl).length
console.log(`étapes avec audioUrl: ${withAudio}/${stepsA.length}  ${withAudio>0?'✅':'❌'}`)
if (stepsA[0]?.audioUrl) console.log(`  ex audioUrl: ${String(stepsA[0].audioUrl).slice(0,90)}…`)
const auR2 = await generateAudioForSheets(sb,'menu_meal_sheets',[{id:menuNoSteps.id, preparation_steps:stepsA}],KARINE_VOICE,true)
console.log(`re-run skipExisting=true → generated:${auR2.generated} skipped:${auR2.skipped}  ${auR2.generated===0&&auR2.skipped>0?'✅ skip OK':'❌'}`)
