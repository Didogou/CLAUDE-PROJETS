'use client'
import React, { useState, useEffect, useRef } from 'react'
import type { Npc, CombatType, CombatMove, CombatLayoutSettings, Item, CombatantState } from '@/types'

type CombatLayoutV3 = NonNullable<CombatLayoutSettings['v3']>

const LAYOUT_DEFAULTS: CombatLayoutV3 = {
  bg:           { vignette_opacity: 0.65, filter: 'none', subject_position: 'center' },
  narrative:    { position_y: 80, bg_opacity: 0.82, bg_color: '#08080f', font_size: 13, font_color: '#e8e8f0', padding: 14, style: 'roman' },
  choices:      { position_y: 24, style: 'card', accent_color: '#d4a84c', font_size: 12, gap: 8, appear: 'cascade', appear_delay_ms: 200, cascade_stagger_ms: 180 },
  hp:           { height: 12, player_color: '#4caf7d', enemy_color: '#e05555', player_name_color: '#4caf7d', enemy_name_color: '#e05555', show_numbers: true, show_names: true, player_x: 16, player_y: 20, enemy_x: 210, enemy_y: 20, bar_width: 155 },
  transition:   { type: 'fade', duration_ms: 350 },
  impact:       { screen_shake: true, damage_font_size: 36, damage_color: '#d4a84c', flash_on_hit: true },
  timing:       { image_hold_ms: 400, narrative_hold_ms: 800, action_hold_ms: 1000, result_hold_ms: 1800 },
  player_turn:  { text: 'Que fais-tu ?', position_y: 220, bg_color: '#000000', bg_opacity: 0 },
  action_text:  { position_y: 22, font_size: 22, color: '#ffffff' },
  phase_texts:  {
    player_hit:  { action: 'Tu frappes',  result: 'Touché !'  },
    player_miss: { action: 'Tu frappes',  result: 'Raté !'    },
    enemy_hit:   { action: 'Il frappe',   result: 'Aïe !'     },
    enemy_miss:  { action: 'Il frappe',   result: 'Esquivé !' },
  },
  end_screens:  { victory_text: 'Tu as gagné !', defeat_text: 'Tu es KO.' },
  player_label: { show: false, position_x: 16, position_y: 60, font_size: 16, color: '#4caf7d', bold: true },
  npc_label:    { show: true,  position_x: 16, position_y: 60, font_size: 18, color: '#ffffff', bold: true },
  dice:         { mode: 'interactive', timeout_ms: 5000, show_enemy_score: true },
}

// ── État des combattants ───────────────────────────────────────────────────
const STATE_INFO: Record<CombatantState, { label: string; emoji: string; bonus: number; forcesRecovery: boolean }> = {
  normal:      { label: '',             emoji: '',   bonus: 0, forcesRecovery: false },
  stunned:     { label: 'Sonné',        emoji: '😵', bonus: 2, forcesRecovery: false },
  bent_low:    { label: 'Plié en deux', emoji: '🫸', bonus: 3, forcesRecovery: false },
  off_balance: { label: 'Déséquilibré', emoji: '🌀', bonus: 2, forcesRecovery: false },
  backed_up:   { label: 'Acculé',       emoji: '↩️', bonus: 1, forcesRecovery: false },
  grounded:    { label: 'Au sol',       emoji: '⬇️', bonus: 4, forcesRecovery: true  },
  fleeing:     { label: 'En fuite',     emoji: '🏃', bonus: 1, forcesRecovery: false },
}

function statModifier(stat: number): number {
  if (stat <= 9)  return -1
  if (stat <= 12) return 0
  if (stat <= 15) return 1
  if (stat <= 18) return 2
  return 3
}

function rollD20(): number { return Math.floor(Math.random() * 20) + 1 }

function pickRandomMove(moves: CombatMove[], weaponType: string | null): CombatMove | null {
  const filtered = moves.filter(m => !m.is_parry && (!m.weapon_type || m.weapon_type === weaponType))
  if (filtered.length === 0) return moves.find(m => !m.is_parry) ?? null
  return filtered[Math.floor(Math.random() * filtered.length)]
}

function moveEmoji(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('tête') || n.includes('tete') || n.includes('front') || n.includes('crane')) return '🤜'
  if (n.includes('poing') || n.includes('frappe') || n.includes('coup') || n.includes('direct')) return '👊'
  if (n.includes('pied') || n.includes('jambe') || n.includes('kick') || n.includes('genou')) return '🦵'
  if (n.includes('relev') || n.includes('sol') || n.includes('debout')) return '⬆️'
  if (n.includes('recul') || n.includes('décal') || n.includes('esquive')) return '↩️'
  if (n.includes('lame') || n.includes('épée') || n.includes('couteau') || n.includes('dague')) return '🗡'
  if (n.includes('arc') || n.includes('flèche')) return '🏹'
  if (n.includes('magie') || n.includes('sort') || n.includes('éclair') || n.includes('feu')) return '✨'
  if (n.includes('bouclier') || n.includes('parade') || n.includes('garde')) return '🛡'
  return '⚔'
}

// ── Types multi-combat ─────────────────────────────────────────────────────
interface MultiCombatant {
  npcId: string
  hp: number
  hpMax: number
  force: number
  agilite: number
  intelligence: number
  state: CombatantState
  isKO: boolean
}

interface CounterAttack {
  enemyIdx: number
  move: CombatMove
  roll: number
  naturalDodge: boolean
  rawDamage: number
}

type CombatPhase = 'target_select' | 'player_dice' | 'victory' | 'defeat'
type DicePhase   = 'attack' | 'recovery' | 'counter' | 'idle'

interface CombatState {
  phase: CombatPhase
  // Player
  playerHp: number
  playerHpMax: number
  playerForce: number
  playerAgilite: number
  playerIntelligence: number
  playerState: CombatantState
  playerIsKO: boolean
  // Multi-combatants
  enemies: MultiCombatant[]
  allies: MultiCombatant[]
  targetEnemyIdx: number  // -1 = not selected yet
  // Display
  stateNarrative: string | null
  round: number
  floatingText: string | null
  floatingColor: string | null
  floatingKey: number
  floatingPosition: 'top' | 'bottom'
  isFlee: boolean
}

interface Props {
  section: {
    id: string
    combat_type_id?: string | null
    trial?: {
      npc_id?: string | null
      enemy_weapon_type?: string | null
      success_section_id?: string | null
      failure_section_id?: string | null
      combat_intro_thought?: string | null
    } | null
  }
  npc: Npc
  protagonist: Npc | null
  combatType: CombatType
  playerWeaponType: string | null
  layout?: CombatLayoutV3 | null
  items?: Item[]
  initialPlayerHp?: number
  extraEnemies?: Npc[]   // additional enemies beyond the main npc
  allies?: Npc[]          // NPC allies fighting alongside the player
  cw?: number            // largeur conteneur (défaut 390) — pour adapter à tous les téléphones
  onVictory: (remainingHp: number) => void
  onDefeat: () => void
  onClose: () => void
}

function getActivePortrait(hp: number, hpMax: number, v3data: Record<string, any>, fallback: string | null): string | null {
  const pct = hp / Math.max(1, hpMax)
  if (pct <= 0.25 && v3data.portrait_25_url) return v3data.portrait_25_url
  if (pct <= 0.50 && v3data.portrait_50_url) return v3data.portrait_50_url
  if (pct <= 0.75 && v3data.portrait_75_url) return v3data.portrait_75_url
  return v3data.neutral_url ?? fallback
}

function makeCombatant(n: Npc): MultiCombatant {
  return {
    npcId: n.id,
    hp: n.endurance ?? 8,
    hpMax: n.endurance ?? 8,
    force: n.force ?? 10,
    agilite: n.agilite ?? 10,
    intelligence: n.intelligence ?? 10,
    state: 'normal',
    isKO: false,
  }
}

export function CombatOverlayV4({
  section, npc, protagonist, combatType, playerWeaponType,
  layout: layoutProp, items = [], initialPlayerHp,
  extraEnemies = [], allies: alliesNpcs = [],
  cw = 390,
  onVictory, onDefeat, onClose,
}: Props) {
  const cwScale = cw / 390  // facteur d'échelle pour adapter au téléphone réel

  const L: CombatLayoutV3 = {
    bg:           { ...LAYOUT_DEFAULTS.bg,           ...(layoutProp?.bg           ?? {}) },
    narrative:    { ...LAYOUT_DEFAULTS.narrative,    ...(layoutProp?.narrative    ?? {}) },
    choices:      { ...LAYOUT_DEFAULTS.choices,      ...(layoutProp?.choices      ?? {}) },
    hp:           { ...LAYOUT_DEFAULTS.hp,           ...(layoutProp?.hp           ?? {}) },
    transition:   { ...LAYOUT_DEFAULTS.transition,   ...(layoutProp?.transition   ?? {}) },
    impact:       { ...LAYOUT_DEFAULTS.impact,       ...(layoutProp?.impact       ?? {}) },
    timing:       { ...LAYOUT_DEFAULTS.timing,       ...(layoutProp?.timing       ?? {}) },
    player_turn:  { ...LAYOUT_DEFAULTS.player_turn,  ...(layoutProp?.player_turn  ?? {}) },
    action_text:  { ...LAYOUT_DEFAULTS.action_text,  ...(layoutProp?.action_text  ?? {}) },
    phase_texts: {
      player_hit:  { ...LAYOUT_DEFAULTS.phase_texts.player_hit,  ...(layoutProp?.phase_texts?.player_hit  ?? {}) },
      player_miss: { ...LAYOUT_DEFAULTS.phase_texts.player_miss, ...(layoutProp?.phase_texts?.player_miss ?? {}) },
      enemy_hit:   { ...LAYOUT_DEFAULTS.phase_texts.enemy_hit,   ...(layoutProp?.phase_texts?.enemy_hit   ?? {}) },
      enemy_miss:  { ...LAYOUT_DEFAULTS.phase_texts.enemy_miss,  ...(layoutProp?.phase_texts?.enemy_miss  ?? {}) },
    },
    end_screens:  { ...LAYOUT_DEFAULTS.end_screens,  ...(layoutProp?.end_screens  ?? {}) },
    player_label: { ...LAYOUT_DEFAULTS.player_label, ...(layoutProp?.player_label ?? {}) },
    npc_label:    { ...LAYOUT_DEFAULTS.npc_label,    ...(layoutProp?.npc_label    ?? {}) },
    dice:         { ...LAYOUT_DEFAULTS.dice!,        ...(layoutProp?.dice         ?? {}) },
  }

  // All NPC references (stable refs for portrait lookup)
  const allEnemyNpcs: Npc[] = [npc, ...extraEnemies]
  const allAllyNpcs: Npc[] = alliesNpcs

  const pv3 = protagonist?.combat_v3 ?? {}
  const playerHpMax = protagonist?.endurance ?? 10
  const enemyWeaponType = section.trial?.enemy_weapon_type ?? null
  const isMultiEnemy = allEnemyNpcs.length > 1

  const allMoves = combatType.moves ?? []

  // ── Sélection des moves selon les états ─────────────────────────────────
  function getPlayerMoves(pState: CombatantState, eState: CombatantState): CombatMove[] {
    if (STATE_INFO[pState].forcesRecovery) {
      const recovery = allMoves.filter(m => m.move_type === 'recovery')
      if (recovery.length > 0) return recovery.slice(0, 3)
      return [
        { id: '_r1', combat_type_id: '', name: 'Se relever vite',      narrative_text: '', bonus_malus: -1, damage: 0, is_parry: false, is_contextual: false, sort_order: 0, created_at: '', move_type: 'recovery' },
        { id: '_r2', combat_type_id: '', name: 'Se relever prudemment', narrative_text: '', bonus_malus:  0, damage: 0, is_parry: false, is_contextual: false, sort_order: 1, created_at: '', move_type: 'recovery' },
        { id: '_r3', combat_type_id: '', name: 'Rester bas et parer',   narrative_text: '', bonus_malus:  1, damage: 0, is_parry: false, is_contextual: false, sort_order: 2, created_at: '', move_type: 'recovery' },
      ]
    }
    if (eState !== 'normal') {
      const contextual = allMoves.filter(m =>
        m.required_state === eState &&
        (!m.weapon_type || m.weapon_type === playerWeaponType)
      )
      if (contextual.length > 0) return contextual.slice(0, 3)
    }
    const standard = allMoves.filter(m =>
      !m.is_parry &&
      (m.move_type === 'attack' || !m.move_type) &&
      !m.required_state &&
      !m.required_self_state &&
      (playerWeaponType === null || !m.weapon_type || m.weapon_type === playerWeaponType)
    ).slice(0, 3)
    if (standard.length > 0) return standard
    return [
      { id: '_a1', combat_type_id: '', name: 'Attaque directe', narrative_text: '', bonus_malus:  0, damage: 2, is_parry: false, is_contextual: false, sort_order: 0, created_at: '' },
      { id: '_a2', combat_type_id: '', name: 'Frappe prudente', narrative_text: '', bonus_malus:  1, damage: 1, is_parry: false, is_contextual: false, sort_order: 1, created_at: '' },
      { id: '_a3', combat_type_id: '', name: 'Coup puissant',   narrative_text: '', bonus_malus: -1, damage: 3, is_parry: false, is_contextual: false, sort_order: 2, created_at: '' },
    ]
  }

  const _enemyAttacks = allMoves.filter(m =>
    !m.is_parry &&
    !m.required_state &&
    m.move_type !== 'contextual' &&
    m.move_type !== 'recovery' &&
    (!m.weapon_type || m.weapon_type === enemyWeaponType)
  ).slice(0, 3)
  const _enemyFallback: CombatMove[] = [
    { id: '_e1', combat_type_id: '', name: 'Frappe',       narrative_text: '', bonus_malus:  0, damage: 2, is_parry: false, is_contextual: false, sort_order: 0, created_at: '' },
    { id: '_e2', combat_type_id: '', name: 'Coup fort',    narrative_text: '', bonus_malus: -1, damage: 3, is_parry: false, is_contextual: false, sort_order: 1, created_at: '' },
    { id: '_e3', combat_type_id: '', name: 'Attaque vive', narrative_text: '', bonus_malus:  1, damage: 1, is_parry: false, is_contextual: false, sort_order: 2, created_at: '' },
  ]
  const enemyMovesList = _enemyAttacks.length > 0 ? _enemyAttacks : _enemyFallback

  const enemyMovesWithParry = enemyMovesList.map(m => ({
    move: m,
    parry: m.paired_move_id ? (allMoves.find(p => p.id === m.paired_move_id) ?? null) : null,
  }))

  function initState(): CombatState {
    return {
      phase: isMultiEnemy ? 'target_select' : 'player_dice',
      playerHp: initialPlayerHp ?? playerHpMax,
      playerHpMax,
      playerForce:        protagonist?.force        ?? 10,
      playerAgilite:      protagonist?.agilite      ?? 10,
      playerIntelligence: protagonist?.intelligence ?? 10,
      playerState: 'normal',
      playerIsKO: false,
      enemies: allEnemyNpcs.map(makeCombatant),
      allies: allAllyNpcs.map(makeCombatant),
      targetEnemyIdx: isMultiEnemy ? -1 : 0,
      stateNarrative: null,
      round: 0,
      floatingText: null, floatingColor: null, floatingKey: 0, floatingPosition: 'top',
      isFlee: false,
    }
  }

  const [state, setState] = useState<CombatState>(initState)
  const [shaking, setShaking]       = useState(false)
  const [flashColor, setFlashColor] = useState<string | null>(null)

  const [dicePhase, setDicePhase_]       = useState<DicePhase>('idle')
  const dicePhaseRef = useRef<DicePhase>('idle')
  function setDicePhase(p: DicePhase) { dicePhaseRef.current = p; setDicePhase_(p) }

  const [pDiceDisplay, setPDiceDisplay] = useState<[number,number,number]>([1,1,1])
  const [eDiceDisplay, setEDiceDisplay] = useState<[number,number,number]>([20,13,6])
  const [selectedDie_,  setSelectedDie_]  = useState<number|null>(null)
  const selectedDieRef = useRef<number|null>(null)
  function setSelectedDie(v: number|null) { selectedDieRef.current = v; setSelectedDie_(v) }
  const selectedDie = selectedDie_
  const [selectedEDie, setSelectedEDie] = useState<number|null>(null)
  const [attackSuccess, setAttackSuccess]   = useState<boolean|null>(null)
  const [counterSuccess, setCounterSuccess] = useState<boolean|null>(null)

  // Moves courants
  const [currentPlayerMoves, setCurrentPlayerMoves] = useState<CombatMove[]>([])
  const [parryKey, setParryKey] = useState(0)

  const stateRef = useRef<CombatState>(state)
  useEffect(() => { stateRef.current = state }, [state])

  // ── Dual counter (2 attaquants simultanés) ────────────────────────────────
  const [counterAttackers, setCounterAttackers] = useState<CounterAttack[]>([])
  const [dualParryChosen, setDualParryChosen_] = useState<number|null>(null)
  const dualParryChosenRef = useRef<number|null>(null)
  function setDualParryChosen(v: number|null) { dualParryChosenRef.current = v; setDualParryChosen_(v) }
  const dualParryWindowRef = useRef(false)
  const [dualParryWindowOpen, setDualParryWindowOpen] = useState(false)
  const [dualParryResolved, setDualParryResolved] = useState(false)
  // Refs pour permettre à handleDualParryTap d'appeler resolveDualCounter directement
  const dualCounterTokenRef = useRef(0)
  const dualCounterAttackersRef = useRef<CounterAttack[]>([])
  const dualCounterResolvedRef = useRef(false)

  // ── Ally floating damage ───────────────────────────────────────────────────
  const [allyFloats, setAllyFloats] = useState<Array<{ enemyIdx: number; text: string; key: number }>>([])

  type DieRef = { value:number; dir:1|-1; wrapCount:number; speed:number; burst:number; timeout:ReturnType<typeof setTimeout>|null }
  const mkDie = (v:number, d:1|-1, s:number): DieRef => ({ value:v, dir:d, wrapCount:0, speed:s, burst:0, timeout:null })

  const pDieRefs = useRef<[DieRef,DieRef,DieRef]>([mkDie(1,1,80), mkDie(7,1,100), mkDie(14,1,65)])
  const eDieRefs = useRef<[DieRef,DieRef,DieRef]>([mkDie(20,-1,75), mkDie(13,-1,95), mkDie(6,-1,60)])
  const diceGenRef       = useRef(0)
  const rollGlobalDirRef = useRef<1|-1>(1)

  // ── Parry refs & state ──────────────────────────────────────────────────
  const [parryWindowOpen, setParryWindowOpen] = useState(false)
  const [parryTappedIdx,  setParryTappedIdx]  = useState<number | null>(null)
  const [parryRevealIdx,  setParryRevealIdx]  = useState<number | null>(null)

  const parryAttemptRef    = useRef<number | null>(null)
  const diceStoppedRef     = useRef(false)
  const parryBeforeStopRef = useRef(false)
  const parryWindowOpenRef = useRef(false)
  const phaseTokenRef = useRef(0)

  // Nettoyage au démontage
  useEffect(() => {
    return () => {
      stopAllDice()
      phaseTokenRef.current = 999999
      parryWindowOpenRef.current = false
      dualParryWindowRef.current = false
      dualCounterResolvedRef.current = true  // empêche toute résolution pendante
      dicePhaseRef.current = 'idle'
    }
  }, [])

  useEffect(() => {
    stopAllDice()
    phaseTokenRef.current = 0
    dicePhaseRef.current = 'idle'
    selectedDieRef.current = null
    dualParryChosenRef.current = null
    const init = initState()
    setState(init)
    setDicePhase('idle')
    setSelectedDie(null); setSelectedEDie(null)
    setAttackSuccess(null); setCounterSuccess(null)
    setPDiceDisplay([1,1,1]); setEDiceDisplay([20,13,6])
    setCurrentPlayerMoves(getPlayerMoves('normal', 'normal'))
    setParryWindowOpen(false); setParryTappedIdx(null); setParryRevealIdx(null)
    parryAttemptRef.current = null; diceStoppedRef.current = false
    parryBeforeStopRef.current = false; parryWindowOpenRef.current = false
    setCounterAttackers([]); setDualParryChosen(null)
    dualParryWindowRef.current = false; setDualParryWindowOpen(false); setDualParryResolved(false)
    dualCounterResolvedRef.current = false; dualCounterAttackersRef.current = []
    setAllyFloats([])
    // Single enemy → start immediately; multi-enemy → wait for target selection
    if (!isMultiEnemy) {
      const t = setTimeout(() => beginAttackDice('normal', 'normal'), 500)
      return () => clearTimeout(t)
    }
  }, [section.id])

  function triggerShake() { setShaking(true); setTimeout(() => setShaking(false), 500) }
  function triggerFlash(color: string) { setFlashColor(color); setTimeout(() => setFlashColor(null), 350) }

  // ── Moteur d'animation des dés ───────────────────────────────────────────
  function advanceDieStep(die: DieRef): number {
    let next = die.value + die.dir
    if (next > 20) {
      next = 1; die.wrapCount++
      if (die.wrapCount >= 2) { die.dir = -1; die.wrapCount = 0 }
    } else if (next < 1) {
      next = 20; die.wrapCount++
      if (die.wrapCount >= 2) { die.dir = 1; die.wrapCount = 0 }
    }
    die.value = next; return next
  }

  function computeSpeed(die: DieRef): number {
    if (die.burst > 0) { die.burst--; return 15 + Math.random() * 10 }
    if (Math.random() < 0.05) { die.burst = Math.floor(Math.random() * 4) + 3; return 15 + Math.random() * 10 }
    die.speed = Math.max(35, Math.min(160, die.speed + (Math.random() - 0.5) * 40))
    let s = die.speed
    if ((die.dir === 1 && die.value >= 16) || (die.dir === -1 && die.value <= 5)) s = Math.max(18, s * 0.33)
    return s
  }

  function startDieLoop(die: DieRef, gen: number, onTick: (v: number) => void) {
    die.timeout = setTimeout(() => {
      if (diceGenRef.current !== gen) return
      const steps = Math.random() < 0.15 ? (Math.random() < 0.5 ? 2 : 3) : 1
      let v = die.value
      for (let i = 0; i < steps; i++) v = advanceDieStep(die)
      onTick(v)
      startDieLoop(die, gen, onTick)
    }, computeSpeed(die))
  }

  function stopAllDice() {
    diceGenRef.current++
    ;[...pDieRefs.current, ...eDieRefs.current].forEach(d => {
      if (d.timeout) { clearTimeout(d.timeout); d.timeout = null }
    })
  }

  // ── Flux de combat ────────────────────────────────────────────────────────

  function beginAttackDice(pState: CombatantState, eState: CombatantState) {
    phaseTokenRef.current++
    const moves = getPlayerMoves(pState, eState)
    setCurrentPlayerMoves(moves)
    const isRecovery = STATE_INFO[pState].forcesRecovery
    const dir = rollGlobalDirRef.current
    const gen = ++diceGenRef.current
    const startVals: [number,number,number] = dir === 1 ? [1,7,14] : [20,13,6]
    pDieRefs.current.forEach((die, i) => {
      die.dir = dir; die.value = startVals[i]; die.wrapCount = 0
      die.speed = [80,100,65][i]; die.burst = 0; die.timeout = null
    })
    setState(s => ({ ...s, phase: 'player_dice', floatingText: null, stateNarrative: isRecovery ? s.stateNarrative : null }))
    setDicePhase(isRecovery ? 'recovery' : 'attack')
    setSelectedDie(null); setSelectedEDie(null)
    setAttackSuccess(null); setCounterSuccess(null)
    setParryTappedIdx(null); setParryRevealIdx(null)
    parryAttemptRef.current = null; parryWindowOpenRef.current = false
    setCounterAttackers([]); setDualParryChosen(null)
    dualParryWindowRef.current = false; setDualParryWindowOpen(false); setDualParryResolved(false)
    dualCounterResolvedRef.current = false
    setPDiceDisplay([...startVals])
    startDieLoop(pDieRefs.current[0], gen, v => setPDiceDisplay(p => [v, p[1], p[2]]))
    startDieLoop(pDieRefs.current[1], gen, v => setPDiceDisplay(p => [p[0], v, p[2]]))
    startDieLoop(pDieRefs.current[2], gen, v => setPDiceDisplay(p => [p[0], p[1], v]))
    const timeoutMs = L.dice?.timeout_ms ?? 0
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (diceGenRef.current !== gen) return
        const vals = pDieRefs.current.map(d => d.value)
        handlePlayerTap(vals.indexOf(Math.min(...vals)))
      }, timeoutMs)
    }
  }

  // Sélection de cible (multi-enemy)
  function handleTargetSelect(enemyIdx: number) {
    const s = stateRef.current
    if (s.phase !== 'target_select') return
    if (s.enemies[enemyIdx]?.isKO) return
    setState(prev => ({ ...prev, targetEnemyIdx: enemyIdx }))
    setTimeout(() => beginAttackDice('normal', 'normal'), 200)
  }

  function handlePlayerTap(moveIdx: number) {
    const dp = dicePhaseRef.current
    if ((dp !== 'attack' && dp !== 'recovery') || selectedDieRef.current !== null) return
    const myToken = ++phaseTokenRef.current
    stopAllDice()
    rollGlobalDirRef.current = rollGlobalDirRef.current === 1 ? -1 : 1

    const move = currentPlayerMoves[moveIdx]
    if (!move) return

    const s = stateRef.current
    const targetIdx = s.targetEnemyIdx >= 0 ? s.targetEnemyIdx : 0
    const targetEnemy = s.enemies[targetIdx]
    if (!targetEnemy) return

    const roll = pDieRefs.current[moveIdx].value
    const stateBonus = STATE_INFO[targetEnemy.state].bonus
    const totalMod = statModifier(s.playerForce) + (move.bonus_malus ?? 0) + stateBonus
    const success = roll + totalMod >= 11
    const damage  = success ? (move.damage ?? 0) : 0
    const newEnemyHp = Math.max(0, targetEnemy.hp - damage)
    const newEnemyState: CombatantState = success && move.creates_state ? move.creates_state : 'normal'
    const narrativeHit = move.narrative_on_hit ?? null

    setSelectedDie(moveIdx)
    setAttackSuccess(success)
    setDicePhase('idle')

    if (success && L.impact.flash_on_hit) triggerFlash('rgba(212,168,76,0.35)')
    if (success && L.impact.screen_shake) triggerShake()

    // Résoudre les attaques des alliés en simultané avec le joueur
    const allyResults: Array<{ allyIdx: number; targetIdx: number; damage: number; hit: boolean }> = []

    // Appliquer d'abord les dégâts du joueur sur la cible
    const updatedEnemiesForAllies = s.enemies.map((e, i) => {
      if (i === targetIdx) return { ...e, hp: newEnemyHp, isKO: newEnemyHp <= 0, state: success ? newEnemyState : e.state }
      return e
    })
    const newEnemiesAfterAllies = [...updatedEnemiesForAllies]

    if (s.allies.length > 0) {
      // Compter les attaques par ennemi (règle : chaque ennemi ne peut parer qu'1 attaque alliée)
      const attacksOnEnemy: Record<number, number> = {}

      s.allies.forEach((ally, allyIdx) => {
        if (ally.isKO) return

        // Cibler l'ennemi actif le plus menaçant (force max)
        const activeEnemies = newEnemiesAfterAllies
          .map((e, i) => ({ e, i }))
          .filter(({ e }) => !e.isKO)
        const bestTarget = activeEnemies.reduce<{ e: MultiCombatant; i: number } | null>((best, cur) => {
          if (!best || cur.e.force > best.e.force) return cur
          return best
        }, null)
        if (!bestTarget) return

        const ei = bestTarget.i
        attacksOnEnemy[ei] = (attacksOnEnemy[ei] ?? 0) + 1

        // L'ennemi peut parer seulement la 1ère attaque alliée reçue
        const isParriable = attacksOnEnemy[ei] === 1
        const allyRoll = rollD20()
        const allyMod = statModifier(ally.force)
        const enemyParryMod = isParriable ? statModifier(newEnemiesAfterAllies[ei].agilite) : 0
        const allyHit = allyRoll + allyMod >= 11 - enemyParryMod
        // Dégâts : basés sur force de l'allié (similaire aux dégâts ennemi)
        const allyDmg = allyHit ? Math.max(1, Math.round(ally.force / 4)) : 0

        if (allyDmg > 0) {
          const newHp = Math.max(0, newEnemiesAfterAllies[ei].hp - allyDmg)
          newEnemiesAfterAllies[ei] = {
            ...newEnemiesAfterAllies[ei],
            hp: newHp,
            isKO: newHp <= 0,
          }
        }
        allyResults.push({ allyIdx, targetIdx: ei, damage: allyDmg, hit: allyHit })
      })
    }

    // Check victory (all enemies KO)
    const allEnemiesKO = newEnemiesAfterAllies.every(e => e.isKO)

    setState(prev => ({
      ...prev,
      enemies: newEnemiesAfterAllies,
      stateNarrative: success && narrativeHit ? narrativeHit : null,
      floatingText: success ? 'Touché !' : 'Raté !',
      floatingColor: success ? '#52c484' : '#e05555',
      floatingKey: prev.floatingKey + 1, floatingPosition: 'top',
    }))

    // Afficher dégâts alliés avec délai
    if (allyResults.length > 0) {
      setTimeout(() => {
        const floats = allyResults
          .filter(r => r.damage > 0)
          .map((r, k) => ({ enemyIdx: r.targetIdx, text: `−${r.damage}`, key: Date.now() + k }))
        if (floats.length > 0) setAllyFloats(floats)
        setTimeout(() => setAllyFloats([]), 2000)
      }, 400)
    }

    if (success && damage > 0) {
      setTimeout(() => {
        setState(prev => ({
          ...prev,
          floatingText: `−${damage}`,
          floatingColor: L.impact.damage_color,
          floatingKey: prev.floatingKey + 1, floatingPosition: 'top',
        }))
      }, 900)
    }

    if (allEnemiesKO) {
      setTimeout(() => setState(s => ({ ...s, phase: 'victory', floatingText: null })), 2500)
      return
    }

    setTimeout(() => { if (phaseTokenRef.current === myToken) runEnemyCounter() }, 1400)
  }

  function handleParryTap(idx: number) {
    if (!parryWindowOpenRef.current) return
    if (parryAttemptRef.current !== null) return
    parryAttemptRef.current = idx
    parryBeforeStopRef.current = !diceStoppedRef.current
    setParryTappedIdx(idx)
  }

  function handleDualParryTap(idx: number) {
    if (!dualParryWindowRef.current) return
    if (dualParryChosenRef.current !== null) return
    if (dualCounterResolvedRef.current) return
    setDualParryChosen(idx)
    resolveDualCounter(dualCounterTokenRef.current, dualCounterAttackersRef.current, idx)
  }

  function runEnemyCounter() {
    const myToken = ++phaseTokenRef.current
    const s = stateRef.current

    // Si le joueur est KO → pas de contre-attaque subie (mode spectateur)
    if (s.playerIsKO) {
      setTimeout(() => {
        if (phaseTokenRef.current !== myToken) return
        setState(prev => advanceRound(prev))
        if (isMultiEnemy) {
          setState(prev => ({ ...prev, targetEnemyIdx: -1, phase: 'target_select' }))
          setDicePhase('idle')
        } else {
          beginAttackDice('normal', 'normal')
        }
      }, 800)
      return
    }

    const targetIdx = s.targetEnemyIdx >= 0 ? s.targetEnemyIdx : 0

    // L'ennemi ciblé contre-attaque TOUJOURS (comportement V4 original)
    // + 1 ennemi non-ciblé supplémentaire max (si multi-combat)
    // Total max : 2 contre-attaquants
    const targetedEnemy = s.enemies[targetIdx]
    const bonusAttacker = isMultiEnemy
      ? s.enemies
          .map((e, i) => ({ e, i }))
          .find(({ e, i }) => !e.isKO && i !== targetIdx) ?? null
      : null

    const counterCandidates: Array<{ e: MultiCombatant; i: number }> = []
    if (targetedEnemy && !targetedEnemy.isKO) counterCandidates.push({ e: targetedEnemy, i: targetIdx })
    if (bonusAttacker) counterCandidates.push(bonusAttacker)

    if (counterCandidates.length === 0) {
      // Tous les ennemis sont KO — ne devrait pas arriver (victoire déjà déclenchée)
      setTimeout(() => {
        if (phaseTokenRef.current !== myToken) return
        setState(prev => advanceRound(prev))
        if (isMultiEnemy) {
          setState(prev => ({ ...prev, targetEnemyIdx: -1, phase: 'target_select' }))
          setDicePhase('idle')
        } else {
          beginAttackDice('normal', 'normal')
        }
      }, 600)
      return
    }

    // Calculer chaque contre-attaque
    const counters: CounterAttack[] = counterCandidates.map(({ e, i }) => {
      const move = enemyMovesList[Math.floor(Math.random() * enemyMovesList.length)]
      const roll = rollD20()
      const mod = statModifier(e.force) + (move.bonus_malus ?? 0)
      const score = roll + mod
      const playerDef = statModifier(s.playerAgilite) + statModifier(s.playerIntelligence)
      const naturalDodge = rollD20() + playerDef >= score
      const rawDamage = naturalDodge ? 0 : (move.damage ?? 0)
      return { enemyIdx: i, move, roll, naturalDodge, rawDamage }
    })

    if (counters.length === 1) {
      // Un seul attaquant → mécanique de parade habituelle (3 cartes)
      runSingleCounter(myToken, counters[0])
    } else {
      // Deux attaquants → mécanique duale (joueur choisit lequel parer)
      runDualCounter(myToken, counters)
    }
  }

  function runSingleCounter(myToken: number, counter: CounterAttack) {
    const s = stateRef.current
    const move = counter.move
    const enemyRoll = counter.roll
    const naturalDodge = counter.naturalDodge
    const rawDamage = counter.rawDamage

    const eMoveIdx  = enemyMovesList.indexOf(move)
    const chosenIdx = eMoveIdx >= 0 ? eMoveIdx : 0

    parryAttemptRef.current = null
    parryBeforeStopRef.current = false
    diceStoppedRef.current = false
    parryWindowOpenRef.current = true
    setParryWindowOpen(true)
    setParryTappedIdx(null)
    setParryRevealIdx(null)
    setParryKey(k => k + 1)

    const dir = rollGlobalDirRef.current === 1 ? -1 : 1
    const eStartVals: [number,number,number] = dir === 1 ? [1,7,14] : [20,13,6]
    eDieRefs.current.forEach((die, i) => {
      die.dir = dir; die.value = eStartVals[i]; die.wrapCount = 0
      die.speed = [75,95,60][i]; die.burst = 0; die.timeout = null
    })

    setDicePhase('counter')
    setCounterSuccess(null)
    setSelectedEDie(null)
    setEDiceDisplay([...eStartVals])

    const gen = ++diceGenRef.current
    startDieLoop(eDieRefs.current[0], gen, v => setEDiceDisplay(p => [v, p[1], p[2]]))
    startDieLoop(eDieRefs.current[1], gen, v => setEDiceDisplay(p => [p[0], v, p[2]]))
    startDieLoop(eDieRefs.current[2], gen, v => setEDiceDisplay(p => [p[0], p[1], v]))

    setTimeout(() => {
      if (phaseTokenRef.current !== myToken) return
      stopAllDice()
      diceStoppedRef.current = true
      eDieRefs.current[chosenIdx].value = enemyRoll
      setEDiceDisplay(prev => {
        const next: [number,number,number] = [...prev]
        next[chosenIdx] = enemyRoll
        return next
      })
      setSelectedEDie(chosenIdx)
      setParryRevealIdx(chosenIdx)

      setTimeout(() => {
        parryWindowOpenRef.current = false
        setParryWindowOpen(false)

        const attempt      = parryAttemptRef.current
        const parrySuccess = attempt === chosenIdx
        const parryBefore  = parryBeforeStopRef.current

        let actualDamage: number
        if (naturalDodge) {
          actualDamage = 0
        } else if (parrySuccess && parryBefore) {
          actualDamage = 0
        } else if (parrySuccess && !parryBefore) {
          actualDamage = Math.ceil(rawDamage / 2)
        } else {
          actualDamage = rawDamage
        }

        const dodged = naturalDodge || parrySuccess
        setCounterSuccess(dodged)
        resolveDamageOnPlayer(myToken, actualDamage, dodged, naturalDodge, parryBefore && parrySuccess, move)
      }, 500)
    }, 1400)
  }

  function runDualCounter(myToken: number, counters: CounterAttack[]) {
    // Afficher les 2 attaquants, joueur choisit lequel parer
    setCounterAttackers(counters)
    setDualParryChosen(null)
    dualParryWindowRef.current = true
    dualCounterTokenRef.current = myToken
    dualCounterAttackersRef.current = counters
    dualCounterResolvedRef.current = false
    setDualParryWindowOpen(true)
    setDualParryResolved(false)
    setDicePhase('counter')

    // Délai de décision : 2.5s pour choisir, sinon auto-choisir 0
    setTimeout(() => {
      if (phaseTokenRef.current !== myToken) return
      if (dualCounterResolvedRef.current) return
      // Pas de choix → auto-choisir 0 (parer le premier attaquant), l'autre touche
      setDualParryChosen(0)
      resolveDualCounter(myToken, counters, 0)
    }, 2500)
  }

  function resolveDualCounter(myToken: number, counters: CounterAttack[], chosen: number) {
    if (dualCounterResolvedRef.current) return
    dualCounterResolvedRef.current = true
    dualParryWindowRef.current = false
    setDualParryResolved(true)

    let totalDamage = 0
    counters.forEach((c, idx) => {
      if (c.naturalDodge) return
      if (idx === chosen) return  // paré → 0 dégâts
      totalDamage += c.rawDamage  // non paré → dégâts complets
    })

    const dodged = counters.every((c, idx) => c.naturalDodge || idx === chosen)
    setTimeout(() => {
      if (phaseTokenRef.current !== myToken) return
      setDualParryWindowOpen(false)
      resolveDamageOnPlayer(myToken, totalDamage, dodged, false, false, counters[chosen]?.move ?? counters[0].move)
    }, 1000)
  }

  function resolveDamageOnPlayer(
    myToken: number,
    actualDamage: number,
    dodged: boolean,
    naturalDodge: boolean,
    parryBefore: boolean,
    move: CombatMove
  ) {
    const s = stateRef.current

    if (!dodged && L.impact.screen_shake) triggerShake()
    if (!dodged && L.impact.flash_on_hit) triggerFlash('rgba(200,50,50,0.45)')

    const floatText = naturalDodge ? 'Esquivé !'
                    : parryBefore  ? 'Paré !'
                    : dodged       ? 'Demi-paré !'
                    : 'Aïe !'

    const newPlayerHp    = Math.max(0, s.playerHp - actualDamage)
    const newPlayerState: CombatantState = actualDamage > 0 && move.creates_state ? move.creates_state : 'normal'
    const newPlayerInt   = dodged ? s.playerIntelligence : Math.max(1, s.playerIntelligence - 1)

    setState(prev => ({
      ...prev, playerHp: newPlayerHp, playerIntelligence: newPlayerInt,
      playerState: newPlayerState,
      stateNarrative: actualDamage > 0 && move.narrative_on_hit ? move.narrative_on_hit : null,
      floatingText: floatText,
      floatingColor: dodged ? '#52c484' : '#e05555',
      floatingKey: prev.floatingKey + 1, floatingPosition: 'bottom',
    }))

    if (actualDamage > 0) {
      setTimeout(() => {
        setState(prev => ({
          ...prev,
          floatingText: `−${actualDamage}`,
          floatingColor: '#e05555',
          floatingKey: prev.floatingKey + 1, floatingPosition: 'bottom',
        }))
      }, 900)
    }

    if (newPlayerHp <= 0) {
      // Vérifier si des alliés sont encore en vie
      const alliesAlive = s.allies.some(a => !a.isKO)
      if (alliesAlive) {
        // Joueur KO → mode spectateur, combat continue
        setState(prev => ({
          ...prev,
          playerIsKO: true,
          playerHp: 0,
          floatingText: null,
        }))
        setTimeout(() => {
          if (phaseTokenRef.current !== myToken) return
          beginNextTurn(myToken, 'normal', 'normal')
        }, 1500)
      } else {
        setTimeout(() => setState(s => ({ ...s, phase: 'defeat', floatingText: null })), 2500)
      }
      return
    }

    setTimeout(() => {
      if (dicePhaseRef.current !== 'counter') return
      beginNextTurn(myToken, newPlayerState, 'normal')
    }, 1000)
  }

  function beginNextTurn(_myToken: number, pState: CombatantState, eState: CombatantState) {
    // Vérification par phase (pas par token) — même pattern que V4 original pour robustesse
    if (dicePhaseRef.current !== 'counter') return
    setState(prev => advanceRound(prev))
    if (isMultiEnemy) {
      // Reset target et afficher la sélection
      setState(prev => ({ ...prev, targetEnemyIdx: -1, phase: 'target_select' }))
      setDicePhase('idle')
    } else {
      beginAttackDice(pState, eState)
    }
  }

  function advanceRound(s: CombatState): CombatState {
    const newRound = s.round + 1
    const pForce = Math.max(0, s.playerForce - 1)
    // Les alliés perdent aussi de la force
    const newAllies = s.allies.map(a => ({ ...a, force: Math.max(0, a.force - 1) }))
    const newEnemies = s.enemies.map(e => ({ ...e, force: Math.max(0, e.force - 1) }))
    let pAgi = s.playerAgilite
    if (newRound % 2 === 0) { pAgi = Math.max(1, pAgi - 1) }
    return { ...s, round: newRound, playerForce: pForce, playerAgilite: pAgi, enemies: newEnemies, allies: newAllies }
  }

  function fleeAttempt() {
    if (dicePhaseRef.current !== 'attack' || selectedDieRef.current !== null) return
    stopAllDice()
    const move = pickRandomMove(allMoves, enemyWeaponType)
    if (!move) {
      setState(s => ({ ...s, phase: 'victory', isFlee: true, floatingText: null })); return
    }
    const s = stateRef.current
    const targetEnemy = s.enemies[s.targetEnemyIdx >= 0 ? s.targetEnemyIdx : 0]
    const force = targetEnemy?.force ?? 10
    const roll = rollD20()
    const success = roll + statModifier(force) + (move.bonus_malus ?? 0) >= 11
    const damage  = success ? (move.damage ?? 0) : 0
    const newPlayerHp = Math.max(0, s.playerHp - damage)
    if (success && L.impact.screen_shake) triggerShake()
    if (success && L.impact.flash_on_hit) triggerFlash('rgba(200,50,50,0.4)')
    setState(prev => ({
      ...prev, playerHp: newPlayerHp,
      floatingText: success ? (damage > 0 ? `−${damage}` : 'Aïe !') : 'Tu fuis !',
      floatingColor: success ? '#e05555' : '#d4a84c',
      floatingKey: prev.floatingKey + 1, floatingPosition: success ? 'bottom' : 'top',
    }))
    if (newPlayerHp <= 0) {
      setTimeout(() => setState(s => ({ ...s, phase: 'defeat', floatingText: null })), 2500)
    } else {
      setTimeout(() => setState(s => ({ ...s, phase: 'victory', isFlee: true, floatingText: null })), 2500)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const { phase, playerHp, playerHpMax: pMax, floatingText, floatingColor, floatingKey,
          floatingPosition, isFlee, playerForce, playerAgilite, playerIntelligence,
          playerState, playerIsKO, stateNarrative, enemies, allies, targetEnemyIdx } = state

  const isEnding = phase === 'victory' || phase === 'defeat'
  const isRecoveryMode = dicePhase === 'recovery'
  const DIE_NUM_SIZE  = 58

  const playerImg = getActivePortrait(playerHp, pMax, pv3, protagonist?.image_url ?? null)

  // ── Pouls ─────────────────────────────────────────────────────────────────
  function computePulse(hp: number, hpMax: number, force: number, forceMax: number): number {
    const vitalite = (hp / Math.max(1, hpMax)) * 0.5 + (force / Math.max(1, forceMax)) * 0.5
    return Math.round(140 + (1 - Math.min(1, Math.max(0, vitalite))) * 60)
  }
  const playerPulse = computePulse(playerHp, pMax, playerForce, protagonist?.force ?? 10)

  // ── Render portrait colonne ───────────────────────────────────────────────
  function renderEnemyColumn(enemy: MultiCombatant, idx: number, total: number) {
    const enemyNpc = allEnemyNpcs[idx]
    if (!enemyNpc) return null
    const v3data = enemyNpc.combat_v3 ?? {}
    const imgUrl = enemy.isKO
      ? (v3data.neutral_url ?? enemyNpc.image_url ?? null)
      : getActivePortrait(enemy.hp, enemy.hpMax, v3data, enemyNpc.image_url ?? null)
    const isTarget = idx === targetEnemyIdx
    const isTargetable = phase === 'target_select' && !enemy.isKO
    const hpPct = enemy.isKO ? 0 : (enemy.hp / Math.max(1, enemy.hpMax)) * 100
    const enemyPulse = computePulse(enemy.hp, enemy.hpMax, enemy.force, enemyNpc.force ?? 10)
    return (
      <div
        key={enemyNpc.id}
        style={{
          flex: 1, position: 'relative', overflow: 'hidden',
          borderRight: idx < total - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none',
          cursor: isTargetable ? 'pointer' : 'default',
          transition: 'box-shadow 0.2s',
          boxShadow: isTarget && !isEnding ? 'inset 0 0 0 2px rgba(212,168,76,0.6)' : 'none',
        }}
        onClick={isTargetable ? () => handleTargetSelect(idx) : undefined}
      >
        {/* Portrait */}
        {imgUrl && (
          <img src={imgUrl} alt="" style={{
            width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top',
            filter: enemy.isKO ? 'grayscale(1) brightness(0.5)' : undefined,
            transition: 'filter 0.5s',
          }} />
        )}
        {!imgUrl && <div style={{ width: '100%', height: '100%', background: '#1a0a0a' }} />}

        {/* Gradient */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.75) 100%)' }} />

        {/* Overlay cible sélectionnée */}
        {isTarget && !isEnding && (
          <div style={{
            position: 'absolute', inset: 0,
            border: '2px solid rgba(212,168,76,0.8)',
            background: 'rgba(212,168,76,0.06)',
            pointerEvents: 'none',
          }} />
        )}

        {/* Overlay ciblable */}
        {isTargetable && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(212,168,76,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'v4-target-pulse 1.2s ease infinite',
          }}>
            <div style={{
              fontSize: '10px', fontWeight: 800, color: '#d4a84c',
              letterSpacing: '0.1em', textShadow: '0 0 12px rgba(212,168,76,0.9)',
              background: 'rgba(0,0,0,0.5)', padding: '3px 8px', borderRadius: '4px',
            }}>
              ◎ CIBLER
            </div>
          </div>
        )}

        {/* KO overlay */}
        {enemy.isKO && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{
              fontSize: '22px', fontWeight: 900, color: '#e05555',
              textShadow: '0 0 16px rgba(224,85,85,0.9)',
              animation: 'v3-pulse 0.7s ease infinite',
            }}>KO</span>
          </div>
        )}

        {/* Dégâts alliés flottants */}
        {allyFloats.filter(f => f.enemyIdx === idx).map(f => (
          <div key={f.key} style={{
            position: 'absolute', top: '30%', left: '50%',
            fontSize: '20px', fontWeight: 900, fontFamily: 'Georgia, serif', fontStyle: 'italic',
            color: '#52c484',
            textShadow: '0 2px 8px rgba(0,0,0,1)',
            animation: 'v3-damage 2s ease forwards',
            pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            {f.text}
          </div>
        ))}

        {/* Info bas : nom + HP bar + état */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 6px 6px', zIndex: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
            <span style={{ fontSize: '9px', fontWeight: 700, color: L.hp.enemy_name_color, textShadow: '0 1px 4px rgba(0,0,0,1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%' }}>
              {enemyNpc.name}
              {enemy.state !== 'normal' && <span style={{ marginLeft: '3px', fontSize: '8px', color: '#ff9f43' }}>{STATE_INFO[enemy.state].emoji}</span>}
            </span>
            {!enemy.isKO && (
              <span style={{ fontSize: '8px', color: '#e05555', display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                <span style={{ display: 'inline-block', animation: 'v4-heart-beat 1s ease infinite', animationDuration: `${(60/enemyPulse).toFixed(2)}s` }}>❤️</span>
              </span>
            )}
          </div>
          <div style={{ height: '6px', background: 'rgba(255,255,255,0.12)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${hpPct}%`, background: L.hp.enemy_color, borderRadius: '3px', transition: 'width 0.5s ease' }} />
          </div>
        </div>
      </div>
    )
  }

  function renderAllyColumn(ally: MultiCombatant, idx: number) {
    const allyNpc = allAllyNpcs[idx]
    if (!allyNpc) return null
    const v3data = allyNpc.combat_v3 ?? {}
    const imgUrl = ally.isKO
      ? (v3data.neutral_url ?? allyNpc.image_url ?? null)
      : getActivePortrait(ally.hp, ally.hpMax, v3data, allyNpc.image_url ?? null)
    const hpPct = ally.isKO ? 0 : (ally.hp / Math.max(1, ally.hpMax)) * 100
    return (
      <div key={allyNpc.id} style={{ flex: 1, position: 'relative', overflow: 'hidden', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
        {imgUrl && (
          <img src={imgUrl} alt="" style={{
            width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top',
            filter: ally.isKO ? 'grayscale(1) brightness(0.5)' : undefined,
            transition: 'filter 0.5s',
          }} />
        )}
        {!imgUrl && <div style={{ width: '100%', height: '100%', background: '#0a1a0a' }} />}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.1) 30%, rgba(0,0,0,0.7) 100%)' }} />
        {ally.isKO && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '18px', fontWeight: 900, color: '#e05555', textShadow: '0 0 12px rgba(224,85,85,0.9)', animation: 'v3-pulse 0.7s ease infinite' }}>KO</span>
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 6px 6px', zIndex: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
            <span style={{ fontSize: '9px', fontWeight: 700, color: L.hp.player_color, textShadow: '0 1px 4px rgba(0,0,0,1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {allyNpc.name}
            </span>
          </div>
          <div style={{ height: '6px', background: 'rgba(255,255,255,0.12)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${hpPct}%`, background: L.hp.player_color, borderRadius: '3px', transition: 'width 0.5s ease' }} />
          </div>
        </div>
      </div>
    )
  }

  function renderDiceRow(
    moves: CombatMove[],
    displays: [number,number,number],
    isPlayerSide: boolean,
    canTap: boolean,
    selectedIdx: number | null,
    successState: boolean | null,
    onTap: (i: number) => void,
  ) {
    const handleZoneTap = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!canTap || selectedIdx !== null) return
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const idx = Math.min(moves.length - 1, Math.floor((e.clientX - rect.left) / rect.width * moves.length))
      onTap(idx)
    }
    return (
      <div
        style={{
          position: 'absolute',
          ...(isPlayerSide
            ? { bottom: 0, left: 0, right: 0, height: '50%' }
            : { top: 0, left: 0, right: 0, height: '50%' }),
          display: 'flex', alignItems: 'stretch',
          overflow: 'hidden', zIndex: 25,
          cursor: canTap ? 'pointer' : 'default',
          touchAction: 'none',
        }}
        onPointerDown={isPlayerSide ? handleZoneTap : undefined}
      >
        <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
          {moves.map((move, i) => {
            const isSelected = selectedIdx === i
            const isOther    = selectedIdx !== null && selectedIdx !== i
            const bm         = move.bonus_malus ?? 0
            const isSuccess  = isSelected ? successState : null
            const accentColor = isSelected
              ? (isSuccess !== null ? (isSuccess ? '#52c484' : '#e05050') : '#d4a84c')
              : isPlayerSide
              ? (canTap ? (isRecoveryMode ? '#54a0ff' : '#d4a84c') : 'rgba(255,255,255,0.15)')
              : (isSelected ? (isSuccess === null ? '#e05555' : isSuccess ? '#52c484' : '#e05555') : 'rgba(224,85,85,0.55)')
            const dieColor = isSelected
              ? accentColor
              : isPlayerSide
              ? (canTap ? (isRecoveryMode ? '#54a0ff' : '#d4a84c') : 'rgba(255,255,255,0.3)')
              : 'rgba(224,85,85,0.75)'
            return (
              <div
                key={move.id}
                style={{
                  flex: 1, position: 'relative',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '5px', padding: '8px 6px',
                  background: 'transparent',
                  borderRight: i < moves.length - 1 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                  overflow: 'hidden',
                  opacity: isOther ? 0.28 : 1,
                  transition: 'opacity 0.3s',
                }}
              >
                <div style={{
                  position: 'absolute',
                  [isPlayerSide ? 'bottom' : 'top']: 0,
                  left: '6%', right: '6%',
                  height: isSelected ? '3px' : canTap ? '2px' : '1px',
                  background: accentColor,
                  borderRadius: '2px',
                  boxShadow: isSelected ? `0 0 12px ${accentColor}, 0 0 24px ${accentColor}55` : undefined,
                  animation: isPlayerSide && canTap && !isSelected ? 'v4-pick-pulse 1.4s ease infinite' : undefined,
                  transition: 'height 0.15s, background 0.2s, box-shadow 0.2s',
                  pointerEvents: 'none',
                  opacity: isOther ? 0.3 : 1,
                }} />
                <div style={{
                  fontSize: '13px', fontWeight: 700, textAlign: 'center',
                  color: '#fff', lineHeight: 1.2, padding: '0 4px',
                  textShadow: '0 0 8px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,1), 0 2px 12px rgba(0,0,0,0.9)',
                  opacity: isOther ? 0.4 : 1,
                  maxHeight: '2.4em', overflow: 'hidden',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {move.name}
                </div>
                <div
                  key={`${displays[i]}-${isSelected}`}
                  style={{
                    fontSize: `${DIE_NUM_SIZE}px`,
                    fontWeight: 900, fontFamily: 'Georgia, serif', lineHeight: 1,
                    color: dieColor,
                    textShadow: '0 0 20px currentColor, 0 2px 8px rgba(0,0,0,1)',
                    animation: isSelected ? 'v3-roll-final 0.35s ease both' : undefined,
                    opacity: isOther ? 0.35 : 1,
                  }}
                >
                  {displays[i]}
                </div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginTop: '-6px', textShadow: '0 1px 4px rgba(0,0,0,1)' }}>d20</div>
                {bm !== 0 && (
                  <div style={{
                    fontSize: '19px', fontWeight: 900,
                    color: bm > 0 ? '#52c484' : '#e07040',
                    background: bm > 0 ? 'rgba(82,196,132,0.25)' : 'rgba(224,112,64,0.25)',
                    borderRadius: '6px', padding: '1px 10px',
                    textShadow: bm > 0 ? '0 0 10px rgba(82,196,132,0.9), 0 1px 4px rgba(0,0,0,1)' : '0 0 10px rgba(224,112,64,0.9), 0 1px 4px rgba(0,0,0,1)',
                    opacity: isOther ? 0.35 : 1,
                  }}>
                    {bm > 0 ? `+${bm}` : `${bm}`}
                  </div>
                )}
                <div style={{ fontSize: '22px', lineHeight: 1, marginTop: '2px', filter: 'drop-shadow(0 1px 4px rgba(0,0,0,1))', opacity: isOther ? 0.35 : 1 }}>
                  {move.icon_url
                    ? <img src={move.icon_url} alt="" style={{ width: 28, height: 28, objectFit: 'contain', filter: isOther ? 'grayscale(1) opacity(0.4)' : undefined }} />
                    : moveEmoji(move.name)
                  }
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const hasAllies = allies.length > 0

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden', zIndex: 200 }}>
    {/* Wrapper de mise à l'échelle — tout le contenu est conçu pour 390px puis scalé */}
    <div style={{
      position: 'absolute', top: 0, left: 0,
      width: 390,
      height: cwScale !== 1 ? `${(100 / cwScale).toFixed(3)}%` : '100%',
      transform: cwScale !== 1 ? `scale(${cwScale.toFixed(5)})` : undefined,
      transformOrigin: 'top left',
      animation: shaking ? 'v3-shake 0.5s ease' : undefined,
    }}>
      <style>{`
        @keyframes v3-shake {
          0%,100% { transform: translate(0,0) }
          20% { transform: translate(-4px,2px) }
          40% { transform: translate(4px,-2px) }
          60% { transform: translate(-3px,3px) }
          80% { transform: translate(3px,-1px) }
        }
        @keyframes v3-damage {
          0%   { opacity:1; transform:translateX(-50%) translateY(0) scale(1.3) }
          70%  { opacity:1; transform:translateX(-50%) translateY(-20px) scale(1.1) }
          100% { opacity:0; transform:translateX(-50%) translateY(-40px) scale(0.9) }
        }
        @keyframes v3-roll-final {
          0%   { transform:scale(1.4); opacity:0.6 }
          60%  { transform:scale(1.1); opacity:1 }
          100% { transform:scale(1);   opacity:1 }
        }
        @keyframes v3-pulse {
          0%,100% { opacity:1 } 50% { opacity:0.35 }
        }
        @keyframes v3-fade-in {
          from { opacity:0 } to { opacity:1 }
        }
        @keyframes v4-state-in {
          from { opacity:0; transform:translateY(-6px) } to { opacity:1; transform:translateY(0) }
        }
        @keyframes v4-heart-beat {
          0%,100% { transform:scale(1) }
          15%     { transform:scale(1.35) }
          30%     { transform:scale(1) }
          45%     { transform:scale(1.18) }
          60%     { transform:scale(1) }
        }
        @keyframes v4-pick-pulse {
          0%,100% { opacity:1; transform:scaleX(1) }
          50%     { opacity:0.28; transform:scaleX(0.82) }
        }
        @keyframes v4-target-pulse {
          0%,100% { opacity:1 }
          50%     { opacity:0.4 }
        }
        @keyframes v4-ko-flash {
          0%,100% { opacity:1 }
          50%     { opacity:0.2 }
        }
      `}</style>

      {/* ── Split screen : portraits ── */}
      <div style={{ position: 'absolute', inset: 0 }}>

        {/* Moitié haute : ennemis */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', display: 'flex', overflow: 'hidden' }}>
          {enemies.map((enemy, idx) => renderEnemyColumn(enemy, idx, enemies.length))}
        </div>

        {/* Séparateur */}
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '3px', background: 'rgba(255,255,255,0.08)', transform: 'translateY(-50%)', zIndex: 3 }} />

        {/* Moitié basse : joueur + alliés */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%', display: 'flex', overflow: 'hidden' }}>
          {/* Portrait joueur */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {playerImg && (
              <img src={playerImg} alt="" style={{
                width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top',
                filter: playerIsKO ? 'grayscale(1) brightness(0.5)' : undefined,
                transition: 'filter 0.5s',
              }} />
            )}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.1) 30%, rgba(0,0,0,0.7) 100%)' }} />
            {playerIsKO && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '22px', fontWeight: 900, color: '#e05555', textShadow: '0 0 16px rgba(224,85,85,0.9)', animation: 'v4-ko-flash 0.7s ease infinite' }}>KO</span>
              </div>
            )}
            {/* HP joueur + stats (compact si alliés présents) */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 6px 6px', zIndex: 2 }}>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.12)', borderRadius: '3px', overflow: 'hidden', marginBottom: '3px' }}>
                <div style={{ height: '100%', width: `${(playerHp/pMax)*100}%`, background: playerHp > pMax*0.4 ? L.hp.player_color : '#e05555', borderRadius: '3px', transition: 'width 0.5s ease' }} />
              </div>
              {!hasAllies && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                    {([
                      { label: 'F', value: playerForce,        max: protagonist?.force        ?? 10, color: '#d4a84c' },
                      { label: 'A', value: playerAgilite,      max: protagonist?.agilite      ?? 10, color: '#4caf7d' },
                      { label: 'I', value: playerIntelligence, max: protagonist?.intelligence ?? 10, color: '#5b9bd5' },
                    ] as const).map(({ label, value, max, color }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <span style={{ fontSize: '7px', color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>{label}</span>
                        <div style={{ height: '4px', width: '22px', background: 'rgba(255,255,255,0.12)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.max(0,(value/max)*100)}%`, background: color, transition: 'width 0.4s ease' }} />
                        </div>
                      </div>
                    ))}
                    {playerState !== 'normal' && (
                      <span style={{ fontSize: '9px', color: '#54a0ff', animation: 'v4-state-in 0.3s ease' }}>
                        {STATE_INFO[playerState].emoji}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, color: L.hp.player_color, display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <span style={{ display: 'inline-block', animation: 'v4-heart-beat 1s ease infinite', animationDuration: `${(60/playerPulse).toFixed(2)}s` }}>❤️</span>
                      {playerPulse}
                    </span>
                    {L.hp.show_numbers && <span style={{ fontSize: '9px', color: L.hp.player_name_color }}>❤ {playerHp}/{pMax}</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Colonnes alliés */}
          {allies.map((ally, idx) => renderAllyColumn(ally, idx))}
        </div>
      </div>

      {flashColor && <div style={{ position: 'absolute', inset: 0, background: flashColor, pointerEvents: 'none', zIndex: 20 }} />}

      {/* ── HP bar joueur compacte (si alliés présents : en haut de la zone basse) ── */}
      {hasAllies && !isEnding && (
        <div style={{ position: 'absolute', bottom: '50%', left: 0, right: 0, zIndex: 10, padding: '0 8px 4px', transform: 'translateY(4px)' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '9px', fontWeight: 700, color: L.hp.player_color }}>
              ❤ {playerHp}/{pMax}
            </span>
            {playerState !== 'normal' && (
              <span style={{ fontSize: '9px', color: '#54a0ff' }}>{STATE_INFO[playerState].emoji}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Indicateur de phase (centre) ── */}
      {phase === 'player_dice' && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 27, pointerEvents: 'none', textAlign: 'center' }}>
          <div style={{
            fontSize: '26px', fontWeight: 900, fontFamily: 'Georgia, serif', letterSpacing: '0.05em',
            color: dicePhase === 'counter'  ? '#e05555'
                 : dicePhase === 'recovery' ? '#54a0ff'
                 : '#d4a84c',
            textShadow: dicePhase === 'counter'  ? '0 0 20px rgba(224,85,85,1), 0 2px 8px rgba(0,0,0,1)'
                      : dicePhase === 'recovery' ? '0 0 20px rgba(84,160,255,1), 0 2px 8px rgba(0,0,0,1)'
                      : '0 0 20px rgba(212,168,76,1), 0 2px 8px rgba(0,0,0,1)',
            animation: dicePhase === 'counter' ? 'v3-pulse 0.8s ease infinite' : 'v4-state-in 0.3s ease',
          }}>
            {dicePhase === 'counter'  ? '🛡 Défense'
           : dicePhase === 'recovery' ? '⬆️ Relève-toi'
           : '⚔ Attaque'}
          </div>
          {isMultiEnemy && targetEnemyIdx >= 0 && enemies[targetEnemyIdx] && dicePhase !== 'counter' && (
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
              → {allEnemyNpcs[targetEnemyIdx]?.name}
            </div>
          )}
        </div>
      )}

      {/* ── Indicateur sélection de cible ── */}
      {phase === 'target_select' && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 27, pointerEvents: 'none', textAlign: 'center' }}>
          <div style={{
            fontSize: '20px', fontWeight: 900, fontFamily: 'Georgia, serif',
            color: '#d4a84c',
            textShadow: '0 0 20px rgba(212,168,76,1), 0 2px 8px rgba(0,0,0,1)',
            animation: 'v4-target-pulse 1s ease infinite',
          }}>
            ◎ Choisis ta cible
          </div>
        </div>
      )}

      {/* ── Dés ennemi (phase counter, 1 attaquant) ── */}
      {phase === 'player_dice' && dicePhase === 'counter' && counterAttackers.length <= 1 && enemyMovesList.length > 0 && (
        renderDiceRow(enemyMovesList, eDiceDisplay, false, false, selectedEDie, counterSuccess, () => {})
      )}

      {/* ── Zones de parade 1 attaquant ── */}
      {phase === 'player_dice' && dicePhase === 'counter' && counterAttackers.length <= 1 && parryWindowOpen && enemyMovesWithParry.length > 0 && (
        <div
          key={parryKey}
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
            display: 'flex', alignItems: 'stretch', overflow: 'hidden', zIndex: 26,
            cursor: parryWindowOpen && parryTappedIdx === null ? 'pointer' : 'default',
            touchAction: 'none',
          }}
          onPointerDown={parryWindowOpen && parryTappedIdx === null ? (e => {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            const idx = Math.min(enemyMovesWithParry.length - 1, Math.floor((e.clientX - rect.left) / rect.width * enemyMovesWithParry.length))
            handleParryTap(idx)
          }) : undefined}
        >
          <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
            {enemyMovesWithParry.map(({ move, parry }, i) => {
              const isTapped   = parryTappedIdx === i
              const isRevealed = parryRevealIdx !== null
              const isCorrect  = isRevealed && parryRevealIdx === i
              const isWrong    = isRevealed && isTapped && parryRevealIdx !== i
              const canTap     = parryWindowOpen && parryTappedIdx === null
              const barColor = isCorrect && isTapped ? '#52c484'
                             : isCorrect             ? '#52c484'
                             : isWrong               ? '#e05555'
                             : isTapped              ? '#54a0ff'
                             : canTap                ? '#54a0ff'
                             : 'rgba(255,255,255,0.1)'
              const nameColor = isCorrect && isTapped ? '#52c484'
                              : isWrong               ? '#e05555'
                              : isTapped              ? '#54a0ff'
                              : 'rgba(255,255,255,0.75)'
              const barHeight = (isCorrect || isWrong || isTapped) ? '3px' : canTap ? '2px' : '1px'
              const barGlow   = (isCorrect || isWrong) ? `0 0 12px ${barColor}, 0 0 24px ${barColor}55` : undefined
              return (
                <div
                  key={move.id}
                  style={{
                    flex: 1, position: 'relative',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: '5px', padding: '8px 6px',
                    background: 'transparent',
                    borderRight: i < enemyMovesWithParry.length - 1 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                    overflow: 'hidden',
                    cursor: canTap ? 'pointer' : 'default',
                    transition: 'opacity 0.2s',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 0, left: '6%', right: '6%',
                    height: barHeight, background: barColor, borderRadius: '2px',
                    boxShadow: barGlow,
                    animation: canTap && !isTapped && !isRevealed ? 'v4-pick-pulse 1.4s ease infinite' : undefined,
                    transition: 'height 0.15s, background 0.2s, box-shadow 0.2s',
                    pointerEvents: 'none',
                  }} />
                  <div style={{ fontSize: '20px', opacity: canTap ? 1 : 0.6, filter: 'drop-shadow(0 1px 4px rgba(0,0,0,1))' }}>🛡</div>
                  <div style={{
                    fontSize: '13px', fontWeight: 700, textAlign: 'center',
                    color: nameColor, lineHeight: 1.3, padding: '0 4px',
                    textShadow: '0 0 8px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,1)',
                  }}>
                    {parry ? (parry.hint_text ?? parry.name) : '?'}
                  </div>
                  {isCorrect && <div style={{ fontSize: '10px', fontWeight: 800, color: '#52c484' }}>{isTapped ? '✓ Paré !' : '← Ici'}</div>}
                  {isWrong && <div style={{ fontSize: '10px', fontWeight: 800, color: '#e05555' }}>✗</div>}
                  {canTap && !isRevealed && <div style={{ fontSize: '9px', color: 'rgba(84,160,255,0.6)', fontWeight: 600, letterSpacing: '0.05em', animation: 'v3-pulse 1.2s ease infinite' }}>PARER</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Zone de parade duale (2 attaquants simultanés) ── */}
      {phase === 'player_dice' && dicePhase === 'counter' && counterAttackers.length === 2 && dualParryWindowOpen && (
        <div
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
            display: 'flex', alignItems: 'stretch', overflow: 'hidden', zIndex: 26,
            touchAction: 'none',
          }}
        >
          {counterAttackers.map((ca, idx) => {
            const attackerNpc = allEnemyNpcs[ca.enemyIdx]
            const isChosen = dualParryChosen === idx
            const isOther  = dualParryChosen !== null && dualParryChosen !== idx
            const resolved = dualParryResolved
            const willHit  = resolved && !isChosen && !ca.naturalDodge && ca.rawDamage > 0
            const wasDodged = ca.naturalDodge
            const borderColor = isChosen ? '#52c484'
                              : isOther && resolved && willHit ? '#e05555'
                              : dualParryWindowRef.current ? '#54a0ff'
                              : 'rgba(255,255,255,0.1)'
            return (
              <div
                key={ca.enemyIdx}
                style={{
                  flex: 1, position: 'relative',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: '8px', padding: '12px 8px',
                  background: isChosen ? 'rgba(82,196,132,0.08)'
                            : isOther && resolved && willHit ? 'rgba(224,85,85,0.08)'
                            : 'transparent',
                  borderRight: idx === 0 ? '1px solid rgba(255,255,255,0.15)' : 'none',
                  overflow: 'hidden',
                  cursor: dualParryWindowRef.current && dualParryChosen === null ? 'pointer' : 'default',
                  transition: 'background 0.3s',
                }}
                onClick={dualParryWindowRef.current && dualParryChosen === null ? () => handleDualParryTap(idx) : undefined}
              >
                {/* Barre highlight */}
                <div style={{
                  position: 'absolute', top: 0, left: '8%', right: '8%',
                  height: isChosen || (resolved && willHit) ? '3px' : '2px',
                  background: borderColor,
                  borderRadius: '2px',
                  boxShadow: isChosen || (resolved && willHit) ? `0 0 12px ${borderColor}` : undefined,
                  animation: !isChosen && !resolved ? 'v4-pick-pulse 1.2s ease infinite' : undefined,
                  transition: 'background 0.2s',
                  pointerEvents: 'none',
                }} />
                {/* Portrait miniature */}
                {attackerNpc?.image_url && (
                  <img src={attackerNpc.image_url} alt="" style={{
                    width: 48, height: 48, borderRadius: '50%', objectFit: 'cover',
                    border: `2px solid ${borderColor}`,
                    opacity: isOther && resolved ? 0.5 : 1,
                  }} />
                )}
                <div style={{
                  fontSize: '11px', fontWeight: 700, textAlign: 'center',
                  color: isChosen ? '#52c484' : resolved && willHit ? '#e05555' : '#fff',
                  textShadow: '0 0 8px rgba(0,0,0,1)',
                }}>
                  {attackerNpc?.name ?? `Ennemi ${ca.enemyIdx + 1}`}
                </div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textAlign: 'center', padding: '0 4px' }}>
                  {ca.move.name}
                </div>
                {!resolved && dualParryWindowRef.current && dualParryChosen === null && (
                  <div style={{ fontSize: '9px', fontWeight: 800, color: '#54a0ff', letterSpacing: '0.08em', animation: 'v3-pulse 1s ease infinite' }}>
                    🛡 PARER
                  </div>
                )}
                {resolved && isChosen && (
                  <div style={{ fontSize: '10px', fontWeight: 800, color: '#52c484' }}>✓ Paré</div>
                )}
                {resolved && !isChosen && !wasDodged && ca.rawDamage > 0 && (
                  <div style={{ fontSize: '10px', fontWeight: 800, color: '#e05555' }}>−{ca.rawDamage}</div>
                )}
                {resolved && wasDodged && (
                  <div style={{ fontSize: '10px', fontWeight: 800, color: '#52c484' }}>Esquivé</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Dés joueur (phases attack / recovery) ── */}
      {phase === 'player_dice' && (dicePhase === 'attack' || dicePhase === 'recovery') && currentPlayerMoves.length > 0 && (
        renderDiceRow(currentPlayerMoves, pDiceDisplay, true, true, selectedDie, attackSuccess, handlePlayerTap)
      )}

      {/* ── Résultat dés joueur (après sélection) ── */}
      {phase === 'player_dice' && dicePhase === 'idle' && selectedDie !== null && currentPlayerMoves.length > 0 && (
        renderDiceRow(currentPlayerMoves, pDiceDisplay, true, false, selectedDie, attackSuccess, () => {})
      )}

      {/* ── Texte flottant ── */}
      {floatingText && (
        <div key={floatingKey} style={{
          position: 'absolute', left: '50%',
          top: floatingPosition === 'top' ? '20%' : '68%',
          fontSize: `${L.impact.damage_font_size}px`,
          fontWeight: 900, fontFamily: 'Georgia, serif', fontStyle: 'italic',
          color: floatingColor ?? (floatingPosition === 'top' ? L.impact.damage_color : '#e05555'),
          textShadow: '0 2px 16px rgba(0,0,0,1), 0 0 40px currentColor',
          animation: 'v3-damage 2.5s ease forwards',
          zIndex: 30, pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {floatingText}
        </div>
      )}

      {/* ── Bouton Fuir ── */}
      {phase === 'player_dice' && dicePhase === 'attack' && selectedDie === null && !playerIsKO && (
        <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', zIndex: 27 }}>
          <button onClick={fleeAttempt} style={{
            padding: '4px 10px', background: 'rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px',
            color: 'rgba(255,255,255,0.45)', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
          }}>
            Fuir
          </button>
        </div>
      )}

      {/* ── Victoire / Défaite ── */}
      {isEnding && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', padding: '24px 16px', background: 'rgba(0,0,0,0.6)' }}>
          <p style={{ margin: '0 0 16px', fontFamily: 'Georgia, serif', fontSize: '30px', fontWeight: 700, fontStyle: 'italic', color: '#fff', textAlign: 'center', textShadow: '2px 2px 10px rgba(0,0,0,1)', animation: 'v3-fade-in 0.5s ease both' }}>
            {phase === 'victory' ? (isFlee ? 'Tu t\'échappes !' : L.end_screens.victory_text) : L.end_screens.defeat_text}
          </p>

          {phase === 'victory' && !isFlee && (() => {
            const npcItems = items.filter(it => allEnemyNpcs.some(e => e.id === it.npc_id))
            if (!npcItems.length) return null
            return (
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
                {npcItems.map(item => (
                  <button key={item.id} onClick={() => {}} style={{ width: 52, height: 52, borderRadius: '10px', background: 'rgba(212,168,76,0.15)', border: `1px solid ${L.choices.accent_color}60`, cursor: 'pointer', padding: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={item.name}>
                    {item.illustration_url ? <img src={item.illustration_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '22px' }}>🎒</span>}
                  </button>
                ))}
              </div>
            )
          })()}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
            {phase === 'victory' && (
              <button onClick={() => {
                // Si joueur KO à la victoire → récupère 10% HP max
                const finalHp = state.playerIsKO ? Math.ceil(pMax * 0.1) : state.playerHp
                onVictory(finalHp)
              }} style={{ width: '100%', padding: '14px', background: `${L.choices.accent_color}22`, border: `1px solid ${L.choices.accent_color}99`, borderRadius: '8px', color: '#fff', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
                Continuer →
              </button>
            )}
            {phase === 'defeat' && (
              <>
                <button onClick={onDefeat} style={{ width: '100%', padding: '13px', background: `${L.choices.accent_color}22`, border: `1px solid ${L.choices.accent_color}99`, borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                  Revenir à la dernière sauvegarde
                </button>
                <button onClick={onClose} style={{ width: '100%', padding: '13px', background: `${L.choices.accent_color}22`, border: `1px solid ${L.choices.accent_color}99`, borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                  Quitter
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
