'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { Npc, CombatType, CombatMove, CombatLayoutSettings, Item, CombatantState } from '@/types'

type CombatLayoutV3 = NonNullable<CombatLayoutSettings['v3']>

// ── Constantes ────────────────────────────────────────────────────────────────
const ACCENT     = '#d4a84c'
const RED_TEAM   = '#e05555'
const GREEN_TEAM = '#4caf7d'
const PORTRAIT_SIZE = 90

const STATE_INFO: Record<CombatantState, { label: string; emoji: string; bonus: number; forcesRecovery: boolean }> = {
  normal:      { label: '',             emoji: '',   bonus: 0, forcesRecovery: false },
  stunned:     { label: 'Sonné',        emoji: '😵', bonus: 2, forcesRecovery: false },
  bent_low:    { label: 'Plié en deux', emoji: '🫸', bonus: 3, forcesRecovery: false },
  off_balance: { label: 'Déséquilibré', emoji: '🌀', bonus: 2, forcesRecovery: false },
  backed_up:   { label: 'Acculé',       emoji: '↩️', bonus: 1, forcesRecovery: false },
  grounded:    { label: 'Au sol',       emoji: '⬇️', bonus: 4, forcesRecovery: true  },
  fleeing:     { label: 'En fuite',     emoji: '🏃', bonus: 1, forcesRecovery: false },
}

function statMod(s: number): number {
  if (s <= 9)  return -1
  if (s <= 12) return 0
  if (s <= 15) return 1
  if (s <= 18) return 2
  return 3
}
function d20(): number { return Math.floor(Math.random() * 20) + 1 }

function getPortrait(hp: number, hpMax: number, v3: Record<string, any>, fallback: string | null): string | null {
  const pct = hp / Math.max(1, hpMax)
  if (pct <= 0.25 && v3.portrait_25_url) return v3.portrait_25_url
  if (pct <= 0.50 && v3.portrait_50_url) return v3.portrait_50_url
  if (pct <= 0.75 && v3.portrait_75_url) return v3.portrait_75_url
  return v3.neutral_url ?? fallback
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface MultiCombatant {
  npcId: string
  hp: number; hpMax: number
  force: number; agilite: number; intelligence: number
  state: CombatantState; isKO: boolean
}

interface FloatMsg {
  id: number; text: string; color: string
  zone: 'enemy' | 'player' | 'center'; idx?: number
}

interface CounterInfo {
  enemyIdx: number; move: CombatMove
  roll: number; naturalDodge: boolean; rawDamage: number
  target: 'player' | number   // 'player' ou index allié
  targetName: string
}

type Phase     = 'target_select' | 'player_dice' | 'spectator' | 'victory' | 'defeat'
type DicePhase = 'attack' | 'recovery' | 'counter' | 'idle'

interface CS {
  phase: Phase
  playerHp: number; playerHpMax: number
  playerForce: number; playerAgilite: number; playerIntelligence: number
  playerState: CombatantState; playerIsKO: boolean
  enemies: MultiCombatant[]; allies: MultiCombatant[]
  targetEnemyIdx: number
  round: number; isFlee: boolean
}

interface Props {
  section: {
    id: string
    trial?: { npc_id?: string | null; enemy_weapon_type?: string | null; success_section_id?: string | null; failure_section_id?: string | null } | null
  }
  npc: Npc; protagonist: Npc | null
  combatType: CombatType; playerWeaponType: string | null
  layout?: CombatLayoutV3 | null; items?: Item[]; initialPlayerHp?: number
  extraEnemies?: Npc[]; allies?: Npc[]
  cw?: number  // largeur conteneur (défaut 390) — pour adapter à tous les téléphones
  onVictory: (hp: number) => void; onDefeat: () => void; onClose: () => void
}

function makeCombatant(n: Npc): MultiCombatant {
  return { npcId: n.id, hp: n.endurance ?? 8, hpMax: n.endurance ?? 8, force: n.force ?? 10, agilite: n.agilite ?? 10, intelligence: n.intelligence ?? 10, state: 'normal', isKO: false }
}

// ── Composant ─────────────────────────────────────────────────────────────────
export function CombatOverlayV6({
  section, npc, protagonist, combatType, playerWeaponType,
  layout: layoutProp, items = [], initialPlayerHp,
  extraEnemies = [], allies: alliesNpcs = [],
  cw = 390,
  onVictory, onDefeat, onClose,
}: Props) {
  const cwScale = cw / 390  // facteur d'échelle pour adapter au téléphone réel

  const accentColor  = layoutProp?.choices?.accent_color ?? ACCENT
  const allEnemyNpcs: Npc[] = [npc, ...extraEnemies]
  const allAllyNpcs:  Npc[] = alliesNpcs
  const isMultiEnemy = allEnemyNpcs.length > 1
  const enemyWeaponType = section.trial?.enemy_weapon_type ?? null
  const allMoves = combatType.moves ?? []

  // Moves joueur
  function getPlayerMoves(pState: CombatantState, eState: CombatantState): CombatMove[] {
    if (STATE_INFO[pState].forcesRecovery) {
      const r = allMoves.filter(m => m.move_type === 'recovery')
      if (r.length) return r.slice(0, 3)
      return [
        { id: '_r1', combat_type_id: '', name: 'Se relever vite',      narrative_text: '', bonus_malus: -1, damage: 0, is_parry: false, is_contextual: false, sort_order: 0, created_at: '', move_type: 'recovery' },
        { id: '_r2', combat_type_id: '', name: 'Se relever prudemment', narrative_text: '', bonus_malus:  0, damage: 0, is_parry: false, is_contextual: false, sort_order: 1, created_at: '', move_type: 'recovery' },
        { id: '_r3', combat_type_id: '', name: 'Rester bas',            narrative_text: '', bonus_malus:  1, damage: 0, is_parry: false, is_contextual: false, sort_order: 2, created_at: '', move_type: 'recovery' },
      ]
    }
    if (eState !== 'normal') {
      const ctx = allMoves.filter(m => m.required_state === eState && (!m.weapon_type || m.weapon_type === playerWeaponType))
      if (ctx.length) return ctx.slice(0, 3)
    }
    const std = allMoves.filter(m => !m.is_parry && (m.move_type === 'attack' || !m.move_type) && !m.required_state && (playerWeaponType === null || !m.weapon_type || m.weapon_type === playerWeaponType)).slice(0, 3)
    if (std.length) return std
    return [
      { id: '_a1', combat_type_id: '', name: 'Attaque directe', narrative_text: '', bonus_malus:  0, damage: 2, is_parry: false, is_contextual: false, sort_order: 0, created_at: '' },
      { id: '_a2', combat_type_id: '', name: 'Frappe prudente', narrative_text: '', bonus_malus:  1, damage: 1, is_parry: false, is_contextual: false, sort_order: 1, created_at: '' },
      { id: '_a3', combat_type_id: '', name: 'Coup puissant',   narrative_text: '', bonus_malus: -1, damage: 3, is_parry: false, is_contextual: false, sort_order: 2, created_at: '' },
    ]
  }

  const enemyAttackMoves = (() => {
    const base = allMoves.filter(m => !m.is_parry && !m.required_state && m.move_type !== 'contextual' && m.move_type !== 'recovery' && (!m.weapon_type || m.weapon_type === enemyWeaponType)).slice(0, 3)
    if (base.length) return base
    return [
      { id: '_e1', combat_type_id: '', name: 'Frappe',       narrative_text: '', bonus_malus:  0, damage: 2, is_parry: false, is_contextual: false, sort_order: 0, created_at: '' },
      { id: '_e2', combat_type_id: '', name: 'Coup fort',    narrative_text: '', bonus_malus: -1, damage: 3, is_parry: false, is_contextual: false, sort_order: 1, created_at: '' },
      { id: '_e3', combat_type_id: '', name: 'Attaque vive', narrative_text: '', bonus_malus:  1, damage: 1, is_parry: false, is_contextual: false, sort_order: 2, created_at: '' },
    ]
  })()

  const enemyMovesWithParry = enemyAttackMoves.map(m => ({
    move: m,
    parry: m.paired_move_id ? (allMoves.find(p => p.id === m.paired_move_id) ?? null) : null,
  }))

  // ── État ──────────────────────────────────────────────────────────────────
  function initState(): CS {
    return {
      phase: isMultiEnemy ? 'target_select' : 'player_dice',
      playerHp: initialPlayerHp ?? (protagonist?.endurance ?? 10),
      playerHpMax: protagonist?.endurance ?? 10,
      playerForce: protagonist?.force ?? 10,
      playerAgilite: protagonist?.agilite ?? 10,
      playerIntelligence: protagonist?.intelligence ?? 10,
      playerState: 'normal', playerIsKO: false,
      enemies: allEnemyNpcs.map(makeCombatant),
      allies: allAllyNpcs.map(makeCombatant),
      targetEnemyIdx: isMultiEnemy ? -1 : 0,
      round: 0, isFlee: false,
    }
  }

  const [state, setState]           = useState<CS>(initState)
  const [shaking, setShaking]       = useState(false)
  const [flashColor, setFlashColor] = useState<string | null>(null)
  const [floatMsgs, setFloatMsgs]   = useState<FloatMsg[]>([])
  const floatIdRef = useRef(0)

  // Dés
  const [dicePhase, setDicePhase_]         = useState<DicePhase>('idle')
  const dicePhaseRef = useRef<DicePhase>('idle')
  function setDicePhase(p: DicePhase) { dicePhaseRef.current = p; setDicePhase_(p) }

  const [pDiceDisplay, setPDiceDisplay]    = useState<[number,number,number]>([1,1,1])
  const [eDiceDisplay, setEDiceDisplay]    = useState<[number,number,number]>([20,13,6])
  const [selectedDie_,  setSelectedDie_]   = useState<number|null>(null)
  const selectedDieRef = useRef<number|null>(null)
  function setSelectedDie(v: number|null) { selectedDieRef.current = v; setSelectedDie_(v) }
  const selectedDie = selectedDie_
  const [selectedEDie,  setSelectedEDie]   = useState<number|null>(null)
  const [attackSuccess, setAttackSuccess]  = useState<boolean|null>(null)
  const [currentPlayerMoves, setCurrentPlayerMoves] = useState<CombatMove[]>([])

  // Parade (single enemy)
  const [parryOpen,      setParryOpen]      = useState(false)
  const [parryTapped,    setParryTapped]    = useState<number|null>(null)
  const [parryReveal,    setParryReveal]    = useState<number|null>(null)
  const [parryKey,       setParryKey]       = useState(0)
  const parryAttemptRef    = useRef<number|null>(null)
  const parryWindowRef     = useRef(false)
  const parryResolvedRef   = useRef(false)

  const stateRef      = useRef<CS>(state)
  const phaseTokenRef = useRef(0)
  useEffect(() => { stateRef.current = state }, [state])

  // Moteur dés
  type DieRef = { value:number; dir:1|-1; wrapCount:number; speed:number; burst:number; timeout:ReturnType<typeof setTimeout>|null }
  const mkDie = (v:number,d:1|-1,s:number): DieRef => ({ value:v, dir:d, wrapCount:0, speed:s, burst:0, timeout:null })
  const pDieRefs = useRef<[DieRef,DieRef,DieRef]>([mkDie(1,1,80), mkDie(7,1,100), mkDie(14,1,65)])
  const eDieRefs = useRef<[DieRef,DieRef,DieRef]>([mkDie(20,-1,75), mkDie(13,-1,95), mkDie(6,-1,60)])
  const diceGenRef       = useRef(0)
  const rollDirRef       = useRef<1|-1>(1)

  function advanceDie(die: DieRef): number {
    let n = die.value + die.dir
    if (n > 20) { n = 1;  die.wrapCount++; if (die.wrapCount >= 2) { die.dir = -1; die.wrapCount = 0 } }
    if (n < 1)  { n = 20; die.wrapCount++; if (die.wrapCount >= 2) { die.dir =  1; die.wrapCount = 0 } }
    die.value = n; return n
  }
  function dieSpeed(die: DieRef): number {
    if (die.burst > 0) { die.burst--; return 15 + Math.random()*10 }
    if (Math.random() < 0.05) { die.burst = Math.floor(Math.random()*4)+3; return 15+Math.random()*10 }
    die.speed = Math.max(35, Math.min(160, die.speed + (Math.random()-0.5)*40))
    let s = die.speed
    if ((die.dir===1 && die.value>=16)||(die.dir===-1 && die.value<=5)) s = Math.max(18, s*0.33)
    return s
  }
  function startLoop(die: DieRef, gen: number, tick: (v:number)=>void) {
    die.timeout = setTimeout(() => {
      if (diceGenRef.current !== gen) return
      const steps = Math.random()<0.15 ? (Math.random()<0.5?2:3) : 1
      let v = die.value
      for (let i=0;i<steps;i++) v = advanceDie(die)
      tick(v); startLoop(die, gen, tick)
    }, dieSpeed(die))
  }
  function stopAllDice() {
    diceGenRef.current++
    ;[...pDieRefs.current, ...eDieRefs.current].forEach(d => { if (d.timeout) { clearTimeout(d.timeout); d.timeout = null } })
  }

  // ── Helpers UI ───────────────────────────────────────────────────────────
  function shake() { setShaking(true); setTimeout(() => setShaking(false), 500) }
  function flash(c: string) { setFlashColor(c); setTimeout(() => setFlashColor(null), 350) }

  function addFloat(text: string, color: string, zone: FloatMsg['zone'], idx?: number) {
    const id = ++floatIdRef.current
    setFloatMsgs(prev => [...prev, { id, text, color, zone, idx }])
    setTimeout(() => setFloatMsgs(prev => prev.filter(m => m.id !== id)), 2200)
  }

  // ── Reset au changement de section ───────────────────────────────────────
  useEffect(() => {
    stopAllDice()
    phaseTokenRef.current = 0
    dicePhaseRef.current = 'idle'
    selectedDieRef.current = null
    parryWindowRef.current = false
    parryResolvedRef.current = false
    const init = initState()
    setState(init)
    setDicePhase('idle')
    setSelectedDie(null); setSelectedEDie(null); setAttackSuccess(null)
    setPDiceDisplay([1,1,1]); setEDiceDisplay([20,13,6])
    setCurrentPlayerMoves(getPlayerMoves('normal','normal'))
    setParryOpen(false); setParryTapped(null); setParryReveal(null)
    parryAttemptRef.current = null
    setFloatMsgs([])
    if (!isMultiEnemy) {
      const t = setTimeout(() => beginAttackDice('normal','normal'), 500)
      return () => clearTimeout(t)
    }
  }, [section.id])

  // Nettoyage au démontage
  useEffect(() => {
    return () => {
      stopAllDice()
      phaseTokenRef.current = 999999
      parryWindowRef.current = false
      parryResolvedRef.current = true
      dicePhaseRef.current = 'idle'
    }
  }, [])

  // ── Combat : attaque joueur ───────────────────────────────────────────────
  function beginAttackDice(pState: CombatantState, eState: CombatantState) {
    phaseTokenRef.current++
    const moves = getPlayerMoves(pState, eState)
    setCurrentPlayerMoves(moves)
    const isRec = STATE_INFO[pState].forcesRecovery
    const dir = rollDirRef.current
    const gen = ++diceGenRef.current
    const sv: [number,number,number] = dir===1 ? [1,7,14] : [20,13,6]
    pDieRefs.current.forEach((d,i) => { d.dir=dir; d.value=sv[i]; d.wrapCount=0; d.speed=[80,100,65][i]; d.burst=0; d.timeout=null })
    setState(s => ({ ...s, phase:'player_dice', }))
    setDicePhase(isRec ? 'recovery' : 'attack')
    setSelectedDie(null); setSelectedEDie(null); setAttackSuccess(null)
    setParryOpen(false); setParryTapped(null); setParryReveal(null)
    parryAttemptRef.current = null; parryWindowRef.current = false; parryResolvedRef.current = false
    setPDiceDisplay([...sv])
    startLoop(pDieRefs.current[0], gen, v => setPDiceDisplay(p => [v,p[1],p[2]]))
    startLoop(pDieRefs.current[1], gen, v => setPDiceDisplay(p => [p[0],v,p[2]]))
    startLoop(pDieRefs.current[2], gen, v => setPDiceDisplay(p => [p[0],p[1],v]))
    rollDirRef.current = rollDirRef.current===1 ? -1 : 1
    const tout = layoutProp?.dice?.timeout_ms ?? 0
    if (tout > 0) setTimeout(() => {
      if (diceGenRef.current !== gen) return
      const vals = pDieRefs.current.map(d => d.value)
      handlePlayerTap(vals.indexOf(Math.min(...vals)))
    }, tout)
  }

  function handleTargetSelect(idx: number) {
    const s = stateRef.current
    if (s.phase !== 'target_select' || s.enemies[idx]?.isKO) return
    setState(prev => ({ ...prev, targetEnemyIdx: idx }))
    setTimeout(() => beginAttackDice('normal','normal'), 200)
  }

  function handlePlayerTap(moveIdx: number) {
    const dp = dicePhaseRef.current
    if ((dp !== 'attack' && dp !== 'recovery') || selectedDieRef.current !== null) return
    const myToken = ++phaseTokenRef.current
    stopAllDice()

    const move = currentPlayerMoves[moveIdx]
    if (!move) return
    const s = stateRef.current
    const ti = s.targetEnemyIdx >= 0 ? s.targetEnemyIdx : 0
    const target = s.enemies[ti]
    if (!target) return

    // ── Attaque joueur ──────────────────────────────────────────────────────
    const roll = pDieRefs.current[moveIdx].value
    const bonus = STATE_INFO[target.state].bonus
    const mod = statMod(s.playerForce) + (move.bonus_malus ?? 0) + bonus
    const success = roll + mod >= 11
    const dmg = success ? (move.damage ?? 0) : 0
    const newEnemyHp = Math.max(0, target.hp - dmg)
    const newEnemyState: CombatantState = success && move.creates_state ? move.creates_state : 'normal'

    setSelectedDie(moveIdx); setDicePhase('idle')

    // ── Séquence temporelle ─────────────────────────────────────────────────
    // t=0      : dés figés, silence — on voit les valeurs
    // t=1200ms : résultat "Touché !" / "Raté !"
    // t=1900ms : flash + secousse + dégâts si touché
    // t=2200ms : attaques des alliés
    // t=2900ms : contre-attaque ennemie

    setTimeout(() => {
      addFloat(success ? 'Touché !' : 'Raté !', success ? '#52c484' : '#e05555', 'center')
      setTimeout(() => setAttackSuccess(success), 700)
      if (success && layoutProp?.impact?.flash_on_hit !== false) setTimeout(() => flash('rgba(212,168,76,0.3)'), 700)
      if (success && layoutProp?.impact?.screen_shake !== false) setTimeout(() => shake(), 700)
      if (success && dmg > 0) setTimeout(() => addFloat(`−${dmg}`, ACCENT, 'enemy', ti), 700)

      // ── Attaques des alliés en simultané ──────────────────────────────────
      const updatedEnemies = s.enemies.map((e, i) =>
        i === ti ? { ...e, hp: newEnemyHp, isKO: newEnemyHp <= 0, state: success ? newEnemyState : e.state } : e
      )
      const attacksPerEnemy: Record<number, number> = {}

      s.allies.forEach((ally, ai) => {
        if (ally.isKO) return
        const actives = updatedEnemies.map((e, i) => ({ e, i })).filter(({ e }) => !e.isKO)
        const best = actives.reduce<{ e: MultiCombatant; i: number } | null>((b, c) => (!b || c.e.force > b.e.force) ? c : b, null)
        if (!best) return
        const ei = best.i
        attacksPerEnemy[ei] = (attacksPerEnemy[ei] ?? 0) + 1
        const isParriable = attacksPerEnemy[ei] === 1
        const ar = d20()
        const am = statMod(ally.force)
        const ep = isParriable ? statMod(updatedEnemies[ei].agilite) : 0
        const hit = ar + am >= 11 - ep
        const adm = hit ? Math.max(1, Math.round(ally.force / 4)) : 0
        const allyNpc = allAllyNpcs[ai]
        const allyName = allyNpc?.name ?? `Allié ${ai+1}`
        setTimeout(() => {
          addFloat(hit ? `${allyName} frappe !` : `${allyName} rate !`, hit ? '#52c484' : '#e05555', 'center')
          if (adm > 0) setTimeout(() => addFloat(`−${adm}`, '#52c484', 'enemy', ei), 500)
        }, 1000 + ai * 200)
        if (adm > 0) {
          const nh = Math.max(0, updatedEnemies[ei].hp - adm)
          updatedEnemies[ei] = { ...updatedEnemies[ei], hp: nh, isKO: nh <= 0 }
        }
      })

      const allKO = updatedEnemies.every(e => e.isKO)
      setState(prev => ({ ...prev, enemies: updatedEnemies }))

      if (allKO) {
        setTimeout(() => setState(s => ({ ...s, phase: 'victory' })), 3200)
        return
      }

      setTimeout(() => { if (phaseTokenRef.current === myToken) runEnemyCounter() }, 1700)
    }, 1200)
  }

  // ── Combat : contre-attaque ennemie ─────────────────────────────────────
  function runEnemyCounter() {
    const myToken = ++phaseTokenRef.current
    const s = stateRef.current
    if (s.playerIsKO) {
      setTimeout(() => { if (phaseTokenRef.current === myToken) startNextTurn(myToken, 'normal') }, 600)
      return
    }

    const liveEnemies = s.enemies.map((e,i) => ({e,i})).filter(({e}) => !e.isKO)
    const liveAllies  = s.allies.map((a,i)  => ({a,i})).filter(({a}) => !a.isKO)
    const nE = liveEnemies.length
    const nA = liveAllies.length
    const ti = s.targetEnemyIdx >= 0 ? s.targetEnemyIdx : 0

    function buildAttack(enemyE: MultiCombatant, enemyI: number, tgt: 'player' | number): CounterInfo {
      const mv = enemyAttackMoves[Math.floor(Math.random() * enemyAttackMoves.length)]
      const r = d20()
      const sc = r + statMod(enemyE.force) + (mv.bonus_malus ?? 0)
      const tgtAgi = tgt === 'player' ? s.playerAgilite : (s.allies[tgt as number]?.agilite ?? 10)
      const tgtInt = tgt === 'player' ? s.playerIntelligence : 10
      const natDodge = d20() + statMod(tgtAgi) + statMod(tgtInt) >= sc
      const tgtName = tgt === 'player'
        ? (protagonist?.name ?? 'Joueur')
        : (allAllyNpcs[tgt as number]?.name ?? `Allié ${(tgt as number) + 1}`)
      return { enemyIdx: enemyI, move: mv, roll: r, naturalDodge: natDodge, rawDamage: natDodge ? 0 : (mv.damage ?? 0), target: tgt, targetName: tgtName }
    }

    const attacks: CounterInfo[] = []

    if (nA === 0) {
      // Pas d'alliés : jusqu'à 2 ennemis attaquent le joueur
      const targeted = s.enemies[ti]
      if (targeted && !targeted.isKO) attacks.push(buildAttack(targeted, ti, 'player'))
      const bonus = liveEnemies.find(({i}) => i !== ti)
      if (bonus) attacks.push(buildAttack(bonus.e, bonus.i, 'player'))
    } else if (nE === nA) {
      // Égalité : chaque ennemi attaque un allié (1 pour 1)
      liveEnemies.forEach(({e,i}, slot) => {
        const tgt = liveAllies[slot % liveAllies.length]
        attacks.push(buildAttack(e, i, tgt.i))
      })
    } else if (nE < nA) {
      // Ennemis en infériorité : chaque ennemi attaque le joueur
      liveEnemies.forEach(({e,i}) => attacks.push(buildAttack(e, i, 'player')))
    } else {
      // Ennemis en supériorité : chaque ennemi fait 2 attaques (joueur + allié aléatoire)
      liveEnemies.forEach(({e,i}) => {
        attacks.push(buildAttack(e, i, 'player'))
        const tgt = liveAllies[Math.floor(Math.random() * liveAllies.length)]
        attacks.push(buildAttack(e, i, tgt.i))
      })
    }

    if (attacks.length === 0) {
      setTimeout(() => { if (phaseTokenRef.current === myToken) startNextTurn(myToken, 'normal') }, 400)
      return
    }

    // Parade manuelle uniquement en solo absolu (1 ennemi, 0 allié)
    if (!isMultiEnemy && nA === 0) {
      runSingleCounterWithParry(myToken, attacks[0])
    } else {
      runAutoCounter(myToken, attacks)
    }
  }

  // Parade manuelle (1 ennemi)
  function runSingleCounterWithParry(myToken: number, counter: CounterInfo) {
    const chosenIdx = Math.max(0, enemyAttackMoves.indexOf(counter.move))

    parryAttemptRef.current = null
    parryWindowRef.current = false
    parryResolvedRef.current = false
    setParryReveal(null); setParryTapped(null); setParryOpen(false)
    setParryKey(k => k+1)

    // Dés ennemi tournent
    const dir = rollDirRef.current
    const sv: [number,number,number] = dir===1 ? [1,7,14] : [20,13,6]
    eDieRefs.current.forEach((d,i) => { d.dir=dir; d.value=sv[i]; d.wrapCount=0; d.speed=[75,95,60][i]; d.burst=0; d.timeout=null })
    setDicePhase('counter'); setSelectedEDie(null); setEDiceDisplay([...sv])
    const gen = ++diceGenRef.current
    startLoop(eDieRefs.current[0], gen, v => setEDiceDisplay(p => [v,p[1],p[2]]))
    startLoop(eDieRefs.current[1], gen, v => setEDiceDisplay(p => [p[0],v,p[2]]))
    startLoop(eDieRefs.current[2], gen, v => setEDiceDisplay(p => [p[0],p[1],v]))

    // 1400ms → dés s'arrêtent → parade s'ouvre
    setTimeout(() => {
      if (phaseTokenRef.current !== myToken) return
      stopAllDice()
      eDieRefs.current[chosenIdx].value = counter.roll
      setEDiceDisplay(prev => { const n: [number,number,number] = [...prev]; n[chosenIdx] = counter.roll; return n })
      setSelectedEDie(chosenIdx)
      setParryReveal(chosenIdx)
      // La fenêtre de parade s'ouvre MAINTENANT (après l'arrêt)
      parryWindowRef.current = true
      setParryOpen(true)

      // 1500ms pour parer
      setTimeout(() => {
        if (parryResolvedRef.current) return
        parryResolvedRef.current = true
        parryWindowRef.current = false
        setParryOpen(false)
        resolveParry(myToken, counter, chosenIdx, parryAttemptRef.current)
      }, 1500)
    }, 1400)
  }

  function resolveParry(myToken: number, counter: CounterInfo, chosenIdx: number, attempt: number | null) {
    const parried = attempt === chosenIdx
    let dmg: number
    if (counter.naturalDodge) { dmg = 0 }
    else if (parried)         { dmg = 0 }
    else                      { dmg = counter.rawDamage }

    const dodged = counter.naturalDodge || parried
    addFloat(counter.naturalDodge ? 'Esquivé !' : parried ? 'Paré !' : 'Aïe !', dodged ? '#52c484' : '#e05555', 'center')
    if (!dodged && layoutProp?.impact?.screen_shake !== false) shake()
    if (!dodged && layoutProp?.impact?.flash_on_hit !== false) flash('rgba(200,50,50,0.45)')
    if (dmg > 0) setTimeout(() => addFloat(`−${dmg}`, '#e05555', 'player'), 700)

    applyDamageToPlayer(myToken, dmg, counter.move)
  }

  // Auto-résolution des contre-attaques (multi ou avec alliés)
  function runAutoCounter(myToken: number, attacks: CounterInfo[]) {
    const s = stateRef.current
    setDicePhase('counter')

    let totalPlayerDmg = 0
    const allyDmgMap: Record<number, number> = {}

    attacks.forEach((a, idx) => {
      const delay = idx * 220
      if (a.naturalDodge) {
        setTimeout(() => addFloat(`${a.targetName} esquive !`, '#52c484', 'center'), 400 + delay)
        return
      }
      // Auto-parade : jet de défense de la cible
      const tgtAgi = a.target === 'player' ? s.playerAgilite : (s.allies[a.target as number]?.agilite ?? 10)
      const tgtInt = a.target === 'player' ? s.playerIntelligence : 10
      const parried = d20() + statMod(tgtAgi) + statMod(tgtInt) >= 12
      if (parried) {
        setTimeout(() => addFloat(`${a.targetName} pare !`, '#52c484', 'center'), 400 + delay)
      } else if (a.target === 'player') {
        totalPlayerDmg += a.rawDamage
        if (a.rawDamage > 0) setTimeout(() => addFloat(`−${a.rawDamage}`, '#e05555', 'player'), 600 + delay)
      } else {
        const ai = a.target as number
        allyDmgMap[ai] = (allyDmgMap[ai] ?? 0) + a.rawDamage
        if (a.rawDamage > 0) setTimeout(() => addFloat(`${a.targetName} −${a.rawDamage}`, '#e05555', 'center'), 600 + delay)
      }
    })

    setTimeout(() => {
      if (phaseTokenRef.current !== myToken) return

      // Appliquer les dégâts aux alliés
      if (Object.keys(allyDmgMap).length > 0) {
        setState(prev => {
          const newAllies = [...prev.allies]
          Object.entries(allyDmgMap).forEach(([idxStr, dmg]) => {
            if (dmg <= 0) return
            const i = parseInt(idxStr)
            const nh = Math.max(0, newAllies[i].hp - dmg)
            newAllies[i] = { ...newAllies[i], hp: nh, isKO: nh <= 0 }
          })
          return { ...prev, allies: newAllies }
        })
      }

      // Appliquer les dégâts au joueur
      if (totalPlayerDmg > 0) {
        addFloat('Aïe !', '#e05555', 'center')
        if (layoutProp?.impact?.screen_shake !== false) shake()
        if (layoutProp?.impact?.flash_on_hit !== false) flash('rgba(200,50,50,0.45)')
      }
      applyDamageToPlayer(myToken, totalPlayerDmg, attacks[0].move)
    }, 900 + attacks.length * 220)
  }

  function applyDamageToPlayer(myToken: number, dmg: number, move: CombatMove) {
    const s = stateRef.current
    const newHp = Math.max(0, s.playerHp - dmg)
    const newInt = dmg > 0 ? Math.max(1, s.playerIntelligence - 1) : s.playerIntelligence
    const newState: CombatantState = dmg > 0 && move.creates_state ? move.creates_state : 'normal'

    setState(prev => ({ ...prev, playerHp: newHp, playerIntelligence: newInt, playerState: newState }))

    if (newHp <= 0) {
      const alliesAlive = s.allies.some(a => !a.isKO)
      if (alliesAlive) {
        // Mode spectateur
        setState(prev => ({ ...prev, playerIsKO: true, playerHp: 0 }))
        setTimeout(() => {
          if (phaseTokenRef.current !== myToken) return
          startSpectatorMode(myToken)
        }, 1500)
      } else {
        setTimeout(() => setState(s => ({ ...s, phase: 'defeat' })), 2500)
      }
      return
    }

    setTimeout(() => {
      if (dicePhaseRef.current !== 'counter') return
      startNextTurn(myToken, newState)
    }, 1200)
  }

  function startNextTurn(myToken: number, pState: CombatantState) {
    if (dicePhaseRef.current !== 'counter') return
    setState(prev => advanceRound(prev))
    if (isMultiEnemy) {
      setState(prev => ({ ...prev, targetEnemyIdx: -1, phase: 'target_select' }))
      setDicePhase('idle')
    } else {
      beginAttackDice(pState, 'normal')
    }
  }

  // ── Mode spectateur (joueur KO) ───────────────────────────────────────────
  function startSpectatorMode(myToken: number) {
    setState(prev => ({ ...prev, phase: 'spectator' }))
    setDicePhase('idle')
    setTimeout(() => runSpectatorTurn(myToken), 1000)
  }

  function runSpectatorTurn(myToken: number) {
    if (phaseTokenRef.current !== myToken) return
    const s = stateRef.current

    // Alliés attaquent
    const updatedEnemies = [...s.enemies]
    const attacksOnEnemy: Record<number, number> = {}
    s.allies.forEach((ally, ai) => {
      if (ally.isKO) return
      const actives = updatedEnemies.map((e,i) => ({ e,i })).filter(({ e }) => !e.isKO)
      const best = actives.reduce<{ e: MultiCombatant; i: number } | null>((b,c) => (!b || c.e.force > b.e.force) ? c : b, null)
      if (!best) return
      const ei = best.i
      attacksOnEnemy[ei] = (attacksOnEnemy[ei] ?? 0) + 1
      const hit = d20() + statMod(ally.force) >= 11 - (attacksOnEnemy[ei] === 1 ? statMod(updatedEnemies[ei].agilite) : 0)
      const adm = hit ? Math.max(1, Math.round(ally.force / 4)) : 0
      const name = allAllyNpcs[ai]?.name ?? `Allié ${ai+1}`
      addFloat(hit ? `${name} frappe !` : `${name} rate !`, hit ? '#52c484' : '#888', 'center')
      if (adm > 0) {
        setTimeout(() => addFloat(`−${adm}`, '#52c484', 'enemy', ei), 400)
        const nh = Math.max(0, updatedEnemies[ei].hp - adm)
        updatedEnemies[ei] = { ...updatedEnemies[ei], hp: nh, isKO: nh <= 0 }
      }
    })

    // Ennemis contre-attaquent (cibles : alliés aléatoires)
    const updatedAllies = [...s.allies]
    const liveEnemies = updatedEnemies.map((e,i) => ({e,i})).filter(({ e }) => !e.isKO)
    liveEnemies.forEach(({ e: enemy }, idx) => {
      const liveAllies = updatedAllies.map((a,i) => ({a,i})).filter(({ a }) => !a.isKO)
      if (!liveAllies.length) return
      const tgt = liveAllies[Math.floor(Math.random() * liveAllies.length)]
      const mv = enemyAttackMoves[Math.floor(Math.random() * enemyAttackMoves.length)]
      const roll = d20()
      const sc = roll + statMod(enemy.force) + (mv.bonus_malus ?? 0)
      const natDodge = d20() + statMod(tgt.a.agilite) >= sc
      const dmg = natDodge ? 0 : (mv.damage ?? 0)
      const allyName = allAllyNpcs[tgt.i]?.name ?? `Allié ${tgt.i+1}`
      setTimeout(() => {
        addFloat(natDodge ? `${allyName} esquive !` : `${allyName} est touché !`, natDodge ? '#52c484' : '#e05555', 'center')
        if (dmg > 0) {
          setTimeout(() => addFloat(`−${dmg}`, '#e05555', 'player'), 400)
          const nh = Math.max(0, updatedAllies[tgt.i].hp - dmg)
          updatedAllies[tgt.i] = { ...updatedAllies[tgt.i], hp: nh, isKO: nh <= 0 }
        }
      }, 600 + idx * 300)
    })

    const allEnemiesKO = updatedEnemies.every(e => e.isKO)
    const allAlliesKO  = updatedAllies.every(a => a.isKO)

    setState(prev => ({ ...prev, enemies: updatedEnemies, allies: updatedAllies }))

    if (allEnemiesKO) {
      setTimeout(() => setState(s => ({ ...s, phase: 'victory' })), 2000)
      return
    }
    if (allAlliesKO) {
      setTimeout(() => setState(s => ({ ...s, phase: 'defeat' })), 2000)
      return
    }

    // Tour suivant en spectateur
    setTimeout(() => {
      if (phaseTokenRef.current !== myToken) return
      setState(prev => advanceRound(prev))
      setTimeout(() => runSpectatorTurn(myToken), 500)
    }, 3000)
  }

  function advanceRound(s: CS): CS {
    const nr = s.round + 1
    return {
      ...s, round: nr,
      playerForce: Math.max(0, s.playerForce - 1),
      playerAgilite: nr % 2 === 0 ? Math.max(1, s.playerAgilite - 1) : s.playerAgilite,
      enemies: s.enemies.map(e => ({ ...e, force: Math.max(0, e.force - 1) })),
      allies:  s.allies.map(a => ({ ...a, force: Math.max(0, a.force - 1) })),
    }
  }

  function handleParryTap(idx: number) {
    if (!parryWindowRef.current || parryAttemptRef.current !== null || parryResolvedRef.current) return
    parryAttemptRef.current = idx
    setParryTapped(idx)
  }

  function fleeAttempt() {
    if (dicePhaseRef.current !== 'attack' || selectedDieRef.current !== null) return
    stopAllDice()
    const s = stateRef.current
    const mv = enemyAttackMoves[Math.floor(Math.random() * enemyAttackMoves.length)]
    const tgt = s.enemies[s.targetEnemyIdx >= 0 ? s.targetEnemyIdx : 0]
    const roll = d20()
    const success = roll + statMod(tgt?.force ?? 10) + (mv.bonus_malus ?? 0) >= 11
    const dmg = success ? (mv.damage ?? 0) : 0
    const newHp = Math.max(0, s.playerHp - dmg)
    if (success) { shake(); flash('rgba(200,50,50,0.4)') }
    setState(prev => ({ ...prev, playerHp: newHp }))
    addFloat(success ? (dmg > 0 ? `−${dmg}` : 'Aïe !') : 'Tu fuis !', success ? '#e05555' : ACCENT, 'center')
    if (newHp <= 0) setTimeout(() => setState(s => ({ ...s, phase: 'defeat' })), 2500)
    else setTimeout(() => setState(s => ({ ...s, phase: 'victory', isFlee: true })), 2500)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const { phase, playerHp, playerHpMax, playerForce, playerAgilite, playerIntelligence,
          playerState, playerIsKO, enemies, allies, targetEnemyIdx, isFlee } = state
  const isEnding = phase === 'victory' || phase === 'defeat'
  const isSpectator = phase === 'spectator'

  // Image de fond : ennemi principal (blurred)
  const mainEnemyV3 = npc.combat_v3 ?? {}
  const bgImage = getPortrait(
    enemies[0]?.hp ?? 0, enemies[0]?.hpMax ?? 8,
    mainEnemyV3, npc.image_url ?? null
  )

  const pv3 = protagonist?.combat_v3 ?? {}
  const playerPortrait = getPortrait(playerHp, playerHpMax, pv3, protagonist?.image_url ?? null)

  // Phase indicator text
  const phaseLabel = phase === 'target_select' ? '◎ Choisis ta cible'
    : dicePhase === 'counter'  ? '🛡 Défense'
    : dicePhase === 'recovery' ? '⬆ Relève-toi'
    : dicePhase === 'attack'   ? '⚔ Attaque'
    : isSpectator              ? '👁 Mode spectateur'
    : ''

  const phaseColor = dicePhase === 'counter' ? '#e05555'
    : dicePhase === 'recovery' ? '#54a0ff'
    : phase === 'target_select' ? ACCENT
    : isSpectator ? '#888'
    : ACCENT

  // ── Portrait circulaire ───────────────────────────────────────────────────
  function renderCircle(
    imgUrl: string | null, name: string,
    hp: number, hpMax: number,
    isKO: boolean, team: 'red' | 'green',
    isTarget: boolean, isTargetable: boolean,
    onClick?: () => void,
    extra?: React.ReactNode
  ) {
    const teamColor = team === 'red' ? RED_TEAM : GREEN_TEAM
    const hpPct = isKO ? 0 : Math.max(0, (hp / Math.max(1, hpMax)) * 100)
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, cursor: isTargetable ? 'pointer' : 'default' }} onClick={onClick}>
        {/* Anneau externe (cible sélectionnée) */}
        <div style={{
          width: PORTRAIT_SIZE + 8, height: PORTRAIT_SIZE + 8,
          borderRadius: '50%', display:'flex', alignItems:'center', justifyContent:'center',
          background: isTarget ? `radial-gradient(circle, ${ACCENT}33, transparent 70%)` : 'transparent',
          animation: isTarget ? 'v6-target-ring 1.5s ease infinite' : isTargetable ? 'v6-target-pulse 1.2s ease infinite' : undefined,
          transition: 'all 0.3s',
        }}>
          <div style={{
            width: PORTRAIT_SIZE, height: PORTRAIT_SIZE, borderRadius: '50%',
            overflow: 'hidden', position: 'relative',
            border: `2.5px solid ${isKO ? '#333' : isTarget ? ACCENT : teamColor}`,
            boxShadow: isKO ? 'none'
              : isTarget ? `0 0 0 3px ${ACCENT}55, 0 0 24px ${ACCENT}88`
              : isTargetable ? `0 0 0 2px ${teamColor}44, 0 0 18px ${teamColor}77, 0 0 0 4px ${teamColor}22`
              : `0 0 0 2px ${teamColor}33, 0 0 12px ${teamColor}55`,
            filter: isKO ? 'grayscale(1) brightness(0.4)' : undefined,
            transition: 'all 0.3s',
          }}>
            {imgUrl
              ? <img src={imgUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'top' }} />
              : <div style={{ width:'100%', height:'100%', background:'#1a1a2a', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, color:'#333' }}>?</div>
            }
            {/* Overlay ciblable */}
            {isTargetable && (
              <div style={{ position:'absolute', inset:0, background:'rgba(212,168,76,0.12)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <span style={{ fontSize:9, fontWeight:800, color:ACCENT, letterSpacing:'0.08em', textShadow:`0 0 8px ${ACCENT}` }}>CIBLER</span>
              </div>
            )}
            {/* KO stamp */}
            {isKO && (
              <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.4)' }}>
                <span style={{ fontSize:14, fontWeight:900, color:'#e05555', letterSpacing:'0.05em', animation:'v6-ko-flash 0.7s ease infinite', textShadow:'0 0 12px #e05555' }}>KO</span>
              </div>
            )}
            {extra}
          </div>
        </div>
        {/* Nom */}
        <div style={{ fontSize:9, fontWeight:700, color: isKO ? '#444' : isTarget ? ACCENT : 'rgba(255,255,255,0.75)', textAlign:'center', maxWidth:80, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'0.04em' }}>
          {name}
        </div>
        {/* Barre HP */}
        <div style={{ width:PORTRAIT_SIZE, height:3, background:'rgba(255,255,255,0.12)', borderRadius:2 }}>
          <div style={{ height:'100%', width:`${hpPct}%`, background: isKO ? '#333' : teamColor, borderRadius:2, transition:'width 0.5s' }} />
        </div>
        {/* HP num */}
        <div style={{ fontSize:8, color:'rgba(255,255,255,0.35)' }}>{isKO ? 'KO' : `${hp}/${hpMax}`}</div>
      </div>
    )
  }

  // ── Dés joueur (centre, grand format) ────────────────────────────────────
  function renderDiceZone() {
    if (playerIsKO || isEnding || isSpectator) return null
    if (dicePhase !== 'attack' && dicePhase !== 'recovery') return null
    // Disparaissent dès que le résultat est connu
    if (attackSuccess !== null) return null
    const canTap = selectedDie === null
    const isRec = dicePhase === 'recovery'
    return (
      <div style={{ display:'flex', justifyContent:'center', gap:10, padding:'6px 0' }}>
        {currentPlayerMoves.map((mv, i) => {
          const isSel = selectedDie === i
          const isOth = selectedDie !== null && selectedDie !== i
          const bm = mv.bonus_malus ?? 0
          const col = isSel
            ? (attackSuccess !== null ? (attackSuccess ? '#52c484' : '#e05555') : ACCENT)
            : canTap ? (isRec ? '#54a0ff' : ACCENT) : 'rgba(255,255,255,0.25)'
          return (
            <div
              key={mv.id}
              onClick={() => canTap && handlePlayerTap(i)}
              style={{
                width:90, borderRadius:12, overflow:'hidden',
                background: isSel
                  ? 'rgba(212,168,76,0.14)'
                  : canTap ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                border: `1.5px solid ${isSel ? col : canTap ? col+'66' : 'rgba(255,255,255,0.08)'}`,
                boxShadow: canTap && !isSel ? `0 0 16px ${col}33` : isSel ? `0 0 20px ${col}55` : 'none',
                opacity: isOth ? 0.2 : 1,
                cursor: canTap ? 'pointer' : 'default',
                transition: 'all 0.2s',
                display:'flex', flexDirection:'column', alignItems:'center', padding:'10px 4px 8px', gap:3,
                animation: canTap && !isSel ? 'v6-die-pulse 1.6s ease infinite' : undefined,
              }}
            >
              {/* Numéro */}
              <div style={{ fontSize:52, fontWeight:900, fontFamily:'Georgia, serif', lineHeight:1, color:col, textShadow:`0 0 20px ${col}aa`, animation: isSel ? 'v6-roll-final 0.35s ease both' : undefined }}>
                {pDiceDisplay[i]}
              </div>
              <div style={{ fontSize:8, color:'rgba(255,255,255,0.3)' }}>d20</div>
              {/* Bonus/malus */}
              {bm !== 0 && (
                <div style={{ fontSize:13, fontWeight:800, color: bm>0?'#52c484':'#e07040', background: bm>0?'rgba(82,196,132,0.2)':'rgba(224,112,64,0.2)', borderRadius:4, padding:'1px 6px' }}>
                  {bm>0?`+${bm}`:bm}
                </div>
              )}
              {/* Nom du move */}
              <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.7)', textAlign:'center', lineHeight:1.2, maxHeight:'2.4em', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', padding:'0 2px' }}>
                {mv.name}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ── Dés ennemi + Parade (single counter) ─────────────────────────────────
  function renderParadeZone() {
    if (isMultiEnemy || dicePhase !== 'counter') return null
    return (
      <div key={parryKey} style={{ display:'flex', flexDirection:'column', gap:8, padding:'8px 12px' }}>
        {/* Dés ennemi */}
        <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
          {enemyAttackMoves.map((mv, i) => {
            const isSel = selectedEDie === i
            return (
              <div key={mv.id} style={{
                width:78, borderRadius:10, padding:'8px 4px 6px', gap:3,
                background: isSel ? 'rgba(224,85,85,0.15)' : 'rgba(255,255,255,0.04)',
                border:`1.5px solid ${isSel ? RED_TEAM : 'rgba(255,255,255,0.08)'}`,
                display:'flex', flexDirection:'column', alignItems:'center',
                boxShadow: isSel ? `0 0 16px ${RED_TEAM}55` : 'none',
              }}>
                <div style={{ fontSize:40, fontWeight:900, fontFamily:'Georgia, serif', lineHeight:1, color: isSel ? RED_TEAM : 'rgba(255,255,255,0.3)', animation: isSel ? 'v6-roll-final 0.35s ease both' : undefined }}>
                  {eDiceDisplay[i]}
                </div>
                <div style={{ fontSize:8, color:'rgba(255,255,255,0.25)' }}>d20</div>
                <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.5)', textAlign:'center', lineHeight:1.2, padding:'0 2px', maxHeight:'2.4em', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                  {mv.name}
                </div>
              </div>
            )
          })}
        </div>

        {/* Cartes de parade (s'affichent après arrêt des dés) */}
        {parryReveal !== null && (
          <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
            {enemyMovesWithParry.map(({ move, parry }, i) => {
              const isTapped  = parryTapped === i
              const isCorrect = parryReveal === i
              const isWrong   = isTapped && parryReveal !== i
              const canTap    = parryOpen && parryTapped === null
              const col = isCorrect && isTapped ? '#52c484'
                : isCorrect ? '#52c484' : isWrong ? '#e05555'
                : isTapped ? '#54a0ff' : canTap ? '#54a0ff' : 'rgba(255,255,255,0.15)'
              return (
                <div
                  key={move.id}
                  onClick={() => handleParryTap(i)}
                  style={{
                    width:78, borderRadius:10, padding:'8px 4px 8px',
                    background: isCorrect && isTapped ? 'rgba(82,196,132,0.15)' : isWrong ? 'rgba(224,85,85,0.12)' : canTap ? 'rgba(84,160,255,0.08)' : 'rgba(255,255,255,0.03)',
                    border:`1.5px solid ${col}`,
                    boxShadow: canTap ? `0 0 12px ${col}44` : isCorrect || isWrong ? `0 0 16px ${col}66` : 'none',
                    cursor: canTap ? 'pointer' : 'default',
                    display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                    animation: canTap && !isTapped ? 'v6-die-pulse 1.2s ease infinite' : undefined,
                    transition:'all 0.2s',
                  }}
                >
                  <div style={{ fontSize:18 }}>🛡</div>
                  <div style={{ fontSize:10, fontWeight:700, color:col, textAlign:'center', lineHeight:1.2, padding:'0 2px' }}>
                    {parry ? (parry.hint_text ?? parry.name) : '?'}
                  </div>
                  {isCorrect && <div style={{ fontSize:9, fontWeight:800, color:'#52c484' }}>{isTapped ? '✓ Paré' : '← Ici'}</div>}
                  {isWrong   && <div style={{ fontSize:9, fontWeight:800, color:'#e05555' }}>✗</div>}
                  {canTap && !isTapped && <div style={{ fontSize:8, color:'rgba(84,160,255,0.7)', animation:'v6-pulse 1s ease infinite', letterSpacing:'0.06em' }}>PARER</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── JSX principal ─────────────────────────────────────────────────────────
  return (
    <div style={{ position:'absolute', inset:0, background:'#04040c', overflow:'hidden', zIndex:200 }}>
    {/* Wrapper de mise à l'échelle — tout le contenu est conçu pour 390px puis scalé */}
    <div style={{
      position:'absolute', top:0, left:0,
      width: 390,
      height: cwScale !== 1 ? `${(100 / cwScale).toFixed(3)}%` : '100%',
      transform: cwScale !== 1 ? `scale(${cwScale.toFixed(5)})` : undefined,
      transformOrigin: 'top left',
      animation: shaking ? 'v6-shake 0.5s ease' : undefined,
    }}>
      <style>{`
        @keyframes v6-shake { 0%,100%{transform:translate(0,0)} 20%{transform:translate(-4px,2px)} 40%{transform:translate(4px,-2px)} 60%{transform:translate(-3px,3px)} 80%{transform:translate(3px,-1px)} }
        @keyframes v6-damage { 0%{opacity:1;transform:translateX(-50%) translateY(0) scale(1.2)} 70%{opacity:1;transform:translateX(-50%) translateY(-18px) scale(1)} 100%{opacity:0;transform:translateX(-50%) translateY(-32px) scale(0.9)} }
        @keyframes v6-roll-final { 0%{transform:scale(1.5);opacity:0.5} 60%{transform:scale(1.1);opacity:1} 100%{transform:scale(1);opacity:1} }
        @keyframes v6-fade-in { from{opacity:0} to{opacity:1} }
        @keyframes v6-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes v6-ko-flash { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes v6-target-pulse { 0%,100%{box-shadow:0 0 0 2px #d4a84c44,0 0 18px #d4a84c77} 50%{box-shadow:0 0 0 4px #d4a84c88,0 0 28px #d4a84caa} }
        @keyframes v6-target-ring { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes v6-die-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
        @keyframes v6-spectator { 0%,100%{opacity:0.6} 50%{opacity:1} }
      `}</style>

      {/* ── Fond flouté ── */}
      <div style={{ position:'absolute', inset:0 }}>
        {bgImage && <img src={bgImage} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'top', filter:'blur(10px) brightness(0.25)', transform:'scale(1.06)' }} />}
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom, rgba(4,4,16,0.5) 0%, rgba(4,4,16,0.85) 100%)' }} />
      </div>

      {flashColor && <div style={{ position:'absolute', inset:0, background:flashColor, pointerEvents:'none', zIndex:20 }} />}

      {/* ── Layout principal ── */}
      <div style={{ position:'relative', zIndex:10, height:'100%', display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* ── Bande ennemis ── */}
        <div style={{ padding:'40px 12px 8px', display:'flex', flexDirection:'column', alignItems:'center', gap:0 }}>
          <div style={{ display:'flex', justifyContent:'center', gap:14, flexWrap:'wrap' }}>
            {enemies.map((enemy, idx) => {
              const en = allEnemyNpcs[idx]
              if (!en) return null
              const v3 = en.combat_v3 ?? {}
              const img = enemy.isKO ? (v3.neutral_url ?? en.image_url ?? null) : getPortrait(enemy.hp, enemy.hpMax, v3, en.image_url ?? null)
              const isTarget = idx === targetEnemyIdx
              const isTargetable = phase === 'target_select' && !enemy.isKO
              return renderCircle(img, en.name, enemy.hp, enemy.hpMax, enemy.isKO, 'red', isTarget, isTargetable,
                isTargetable ? () => handleTargetSelect(idx) : undefined)
            })}
          </div>
        </div>

        {/* ── Zone centrale : phase + floats ── */}
        <div style={{ flex:1, position:'relative', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:0 }}>
          {/* Indicateur de phase */}
          {phaseLabel && !isEnding && (
            <div style={{
              fontSize: phase === 'target_select' ? 18 : 20, fontWeight:900,
              fontFamily:'Georgia, serif', letterSpacing:'0.04em',
              color: phaseColor, textShadow:`0 0 20px ${phaseColor}aa, 0 2px 8px rgba(0,0,0,1)`,
              animation: dicePhase === 'counter' ? 'v6-pulse 0.9s ease infinite' : isSpectator ? 'v6-spectator 2s ease infinite' : 'v6-fade-in 0.3s ease',
              marginBottom: 4,
            }}>
              {phaseLabel}
            </div>
          )}
          {/* Nom de la cible en cours */}
          {(dicePhase === 'attack' || dicePhase === 'recovery') && targetEnemyIdx >= 0 && !playerIsKO && (
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.35)', letterSpacing:'0.05em' }}>
              → {allEnemyNpcs[targetEnemyIdx]?.name}
            </div>
          )}

          {/* Dés joueur — centrés, grands */}
          {renderDiceZone()}

          {/* Floats centraux */}
          {floatMsgs.filter(m => m.zone === 'center').map((m, k) => (
            <div key={m.id} style={{
              fontSize: 22, fontWeight:900, fontFamily:'Georgia, serif', fontStyle:'italic',
              color: m.color, textShadow:'0 2px 12px rgba(0,0,0,1), 0 0 30px currentColor',
              animation:'v6-damage 2.2s ease forwards',
              position:'absolute', left:'50%', top:`${30 + k*18}%`,
              pointerEvents:'none', whiteSpace:'nowrap',
            }}>
              {m.text}
            </div>
          ))}
        </div>

        {/* ── Bande joueur + alliés ── */}
        <div style={{ padding:'8px 12px 4px', display:'flex', flexDirection:'column', alignItems:'center', gap:0 }}>
          <div style={{ display:'flex', justifyContent:'center', gap:12, flexWrap:'wrap' }}>
            {/* Joueur */}
            {renderCircle(
              playerPortrait,
              protagonist?.name ?? 'Joueur',
              playerHp, playerHpMax,
              playerIsKO, 'green',
              false, false
            )}
            {/* Alliés */}
            {allies.map((ally, idx) => {
              const an = allAllyNpcs[idx]
              if (!an) return null
              const av3 = an.combat_v3 ?? {}
              const aImg = ally.isKO ? (av3.neutral_url ?? an.image_url ?? null) : getPortrait(ally.hp, ally.hpMax, av3, an.image_url ?? null)
              return renderCircle(aImg, an.name, ally.hp, ally.hpMax, ally.isKO, 'green', false, false)
            })}
          </div>

          {/* ── Zone parade (single counter) ── */}
          {renderParadeZone()}

          {/* Bouton fuir */}
          {dicePhase === 'attack' && selectedDie === null && !playerIsKO && (
            <div style={{ marginTop:4 }}>
              <button onClick={fleeAttempt} style={{ padding:'3px 12px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:6, color:'rgba(255,255,255,0.35)', fontSize:10, fontWeight:600, cursor:'pointer', letterSpacing:'0.04em' }}>
                Fuir
              </button>
            </div>
          )}
        </div>

        {/* ── Barre HP joueur compacte (toujours visible) ── */}
        {!isEnding && (
          <div style={{ padding:'4px 16px 8px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ flex:1, display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ fontSize:8, color: playerIsKO ? '#e05555' : GREEN_TEAM, fontWeight:700, whiteSpace:'nowrap' }}>
                {playerIsKO ? '💀 KO' : `❤ ${playerHp}/${playerHpMax}`}
              </div>
              <div style={{ flex:1, height:3, background:'rgba(255,255,255,0.1)', borderRadius:2, maxWidth:100 }}>
                <div style={{ height:'100%', width:`${playerIsKO ? 0 : (playerHp/playerHpMax)*100}%`, background: playerHp > playerHpMax*0.4 ? GREEN_TEAM : '#e05555', borderRadius:2, transition:'width 0.5s' }} />
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              {([{ l:'F', v:playerForce, max:protagonist?.force??10, c:'#d4a84c' },
                 { l:'A', v:playerAgilite, max:protagonist?.agilite??10, c:GREEN_TEAM },
                 { l:'I', v:playerIntelligence, max:protagonist?.intelligence??10, c:'#5b9bd5' }] as const
              ).map(({ l, v, max, c }) => (
                <div key={l} style={{ display:'flex', alignItems:'center', gap:2 }}>
                  <span style={{ fontSize:7, color:'rgba(255,255,255,0.4)', fontWeight:700 }}>{l}</span>
                  <div style={{ height:3, width:20, background:'rgba(255,255,255,0.1)', borderRadius:2, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${Math.max(0,(v/max)*100)}%`, background:c, transition:'width 0.4s' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Victoire / Défaite ── */}
      {isEnding && (
        <div style={{ position:'absolute', inset:0, zIndex:40, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-end', padding:'24px 16px', background:'rgba(0,0,0,0.7)' }}>
          <p style={{ margin:'0 0 16px', fontFamily:'Georgia, serif', fontSize:28, fontWeight:700, fontStyle:'italic', color:'#fff', textAlign:'center', textShadow:'2px 2px 10px rgba(0,0,0,1)', animation:'v6-fade-in 0.5s ease both' }}>
            {phase === 'victory' ? (isFlee ? "Tu t'échappes !" : "Tu as gagné !") : "Défaite..."}
          </p>
          {phase === 'victory' && playerIsKO && (
            <p style={{ margin:'0 0 12px', fontSize:12, color:'rgba(255,255,255,0.5)', textAlign:'center' }}>
              Tu reprends conscience… 10% de vie récupérés.
            </p>
          )}
          <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%' }}>
            {phase === 'victory' && (
              <button onClick={() => onVictory(playerIsKO ? Math.ceil(playerHpMax*0.1) : playerHp)} style={{ width:'100%', padding:14, background:`${accentColor}22`, border:`1px solid ${accentColor}99`, borderRadius:8, color:'#fff', fontSize:15, fontWeight:700, cursor:'pointer' }}>
                Continuer →
              </button>
            )}
            {phase === 'defeat' && (
              <>
                <button onClick={onDefeat} style={{ width:'100%', padding:13, background:`${accentColor}22`, border:`1px solid ${accentColor}99`, borderRadius:8, color:'#fff', fontSize:14, fontWeight:600, cursor:'pointer' }}>Revenir à la sauvegarde</button>
                <button onClick={onClose}  style={{ width:'100%', padding:13, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, color:'rgba(255,255,255,0.5)', fontSize:14, cursor:'pointer' }}>Quitter</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
