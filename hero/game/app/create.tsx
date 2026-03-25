import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, Pressable,
  ActivityIndicator, Platform, Animated, Dimensions,
} from 'react-native'
import { Audio } from 'expo-av'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { supabase } from '@/src/lib/supabase'
import { COLORS, FONTS } from '@/src/constants/theme'
import type { NPC, CharacterStats } from '@/src/types'

const BOOK_ID = process.env.EXPO_PUBLIC_BOOK_ID!
const { width, height } = Dimensions.get('window')
const ND = Platform.OS !== 'web'

// ─── Mécanique dés ───────────────────────────────────────────────────────────

function d6() { return Math.floor(Math.random() * 6) + 1 }

function rollStats(npc: NPC): CharacterStats {
  const endurance = d6() + d6() + Math.max(npc.endurance - 10, 6)
  return {
    endurance,
    max_endurance: endurance,
    force:        d6() + Math.max(npc.force - 4, 3),
    agilite:      d6() + Math.max(npc.agilite - 4, 3),
    intelligence: d6() + Math.max(npc.intelligence - 4, 3),
    magie:        0,
    chance:       d6() + Math.max(npc.chance - 2, 2),
    inventory:    [],
  }
}

// ─── Cellule stat avec animation slot-machine ─────────────────────────────────

const STATS_DEFS = [
  { key: 'force',        label: 'Force' },
  { key: 'agilite',      label: 'Agilité' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'chance',       label: 'Chance' },
  { key: 'endurance',    label: 'Endurance' },
]

function StatRow({ label, value, animKey }: { label: string; value: number | null; animKey: number }) {
  const [display, setDisplay] = useState('??')

  useEffect(() => {
    if (value === null) { setDisplay('??'); return }
    let ticks = 0
    const interval = setInterval(() => {
      ticks++
      if (ticks >= 18) {
        clearInterval(interval)
        setDisplay(String(value))
      } else {
        setDisplay(String(Math.floor(Math.random() * 20) + 1))
      }
    }, 45)
    return () => clearInterval(interval)
  }, [animKey])

  const revealed = display !== '??' && value !== null

  return (
    <View style={row.container}>
      <Text style={row.label}>{label.toUpperCase()}</Text>
      <Text style={[row.value, revealed && row.valueRevealed]}>{display}</Text>
    </View>
  )
}

const row = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  label: {
    fontFamily: FONTS.heading,
    fontSize: 15,
    fontWeight: '900',
    fontStyle: 'italic',
    color: '#d4a84c',
    letterSpacing: 1.5,
  },
  value: {
    fontFamily: FONTS.heading,
    fontSize: 28,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.2)',
    minWidth: 44,
    textAlign: 'right',
  },
  valueRevealed: {
    color: '#ede9df',
  },
})

// ─── Écran ────────────────────────────────────────────────────────────────────

const MAX_ROLLS = 3

export default function CreateScreen() {
  const [protagonist, setProtagonist] = useState<NPC | null>(null)
  const [stats, setStats]             = useState<CharacterStats | null>(null)
  const [animKey, setAnimKey]         = useState(0)
  const [rolling, setRolling]         = useState(false)
  const [rollsLeft, setRollsLeft]     = useState(MAX_ROLLS)
  const [rolled, setRolled]           = useState(false)
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  // Pulsation bouton dés
  const pulse   = useRef(new Animated.Value(1)).current
  // Pulsation bordure CTA
  const glowAnim = useRef(new Animated.Value(0)).current
  // Musique de fond
  const soundRef = useRef<Audio.Sound | null>(null)

  useEffect(() => { loadProtagonist() }, [])

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync()
    }
  }, [])

  useEffect(() => {
    if (rolled) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.04, duration: 800, useNativeDriver: ND }),
      Animated.timing(pulse, { toValue: 1,    duration: 800, useNativeDriver: ND }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [rolled])

  useEffect(() => {
    if (!rolled) { glowAnim.setValue(0); return }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
      Animated.timing(glowAnim, { toValue: 0, duration: 1200, useNativeDriver: false }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [rolled])

  async function loadProtagonist() {
    const { data: book } = await supabase
      .from('books').select('protagonist_npc_id').eq('id', BOOK_ID).single()
    if (!book?.protagonist_npc_id) { setLoading(false); return }
    const { data: npc } = await supabase
      .from('npcs').select('*').eq('id', book.protagonist_npc_id).single()
    if (npc) {
      setProtagonist(npc as NPC)
      const musicUrl = (npc as any).name_image_settings?.music_url
      if (musicUrl) {
        try {
          await Audio.setAudioModeAsync({ playsInSilentModeIOS: true })
          const { sound } = await Audio.Sound.createAsync(
            { uri: musicUrl },
            { isLooping: true, volume: 0.7 }
          )
          soundRef.current = sound
          await sound.playAsync()
        } catch {}
      }
    }
    setLoading(false)
  }

  function rollDice() {
    if (!protagonist || rolling || rollsLeft <= 0) return
    setRolling(true)
    setStats(rollStats(protagonist))
    setAnimKey(k => k + 1)
    const newLeft = rollsLeft - 1
    setRollsLeft(newLeft)
    setTimeout(() => {
      setRolling(false)
      setRolled(true)
    }, 900)
  }

  async function startAdventure() {
    if (!stats || !protagonist) return
    await soundRef.current?.stopAsync()
    setSaving(true)
    setError(null)

    const { data: firstSection } = await supabase
      .from('sections').select('id').eq('book_id', BOOK_ID).eq('number', 1).single()

    if (!firstSection) {
      setError('Impossible de charger le livre.')
      setSaving(false)
      return
    }

    const { error: dbErr } = await supabase
      .from('user_progress').upsert({
        book_id: BOOK_ID,
        current_section_id: firstSection.id,
        character: { ...stats, name: protagonist.name },
        visited_sections: [firstSection.id],
        npc_memories: {}, tension_overrides: {},
      }, { onConflict: 'book_id' })

    if (dbErr) { setError('Erreur lors de la sauvegarde.'); setSaving(false); return }
    router.replace('/play')
  }

  if (loading) {
    return <View style={s.center}><ActivityIndicator color={COLORS.accent} size="large" /></View>
  }
  if (!protagonist) {
    return <View style={s.center}><Text style={{ color: COLORS.danger }}>Protagoniste introuvable.</Text></View>
  }

  const portraitUrl = protagonist.portrait_url ?? protagonist.image_url
  const canRoll = rollsLeft > 0 && !rolling
  const canStart = rolled && !saving

  return (
    <View style={s.root}>

      {/* ── Background plein écran ── */}
      {protagonist.background_image_url ? (
        <Image
          source={{ uri: protagonist.background_image_url }}
          style={[StyleSheet.absoluteFillObject, { opacity: 0.45 }]}
          contentFit="cover"
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#08090e' }]} />
      )}

      {/* Overlay sombre pour lisibilité */}
      <View style={s.overlay} />

      {/* ── Contenu principal ── */}
      <View style={s.content}>

        {/* ── Colonne gauche : portrait ── */}
        <View style={s.leftCol}>
          {/* Portrait */}
          <View style={s.portraitWrap}>
            {portraitUrl ? (
              <Image source={{ uri: portraitUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" contentPosition="top" />
            ) : (
              <View style={s.portraitFallback}>
                <Text style={s.portraitInitial}>{protagonist.name[0]}</Text>
              </View>
            )}
            {/* Gradient bas sur portrait */}
            <View style={s.portraitGradient} />
          </View>

          {/* Nom — image stylisée avec paramètres de position/taille */}
          {protagonist.name_image_url ? (() => {
            const ns = protagonist.name_image_settings ?? {}
            const w  = ns.width    ?? 180
            const b  = ns.bottom   ?? 28
            const l  = ns.left     ?? 0
            const r  = ns.rotation ?? -8
            return (
              <View style={{
                position: 'absolute',
                bottom: b,
                left: l,
                transform: [{ rotate: `${r}deg` }],
                zIndex: 10,
              }} pointerEvents="none">
                <Image
                  source={{ uri: protagonist.name_image_url }}
                  style={{ width: w, height: w * 0.35, }}
                  contentFit="contain"
                />
              </View>
            )
          })() : null}
        </View>

        {/* ── Colonne droite : stats + illustrations ── */}
        <View style={s.rightCol}>

          {/* Inventaire */}
          <Text style={s.inventoryHint}>T'as rien dans ton inventaire</Text>

          {/* Stats */}
          <View style={s.statsBlock}>
            {STATS_DEFS.map(({ key, label }) => (
              <StatRow
                key={key}
                label={label}
                value={stats ? (stats as any)[key] : null}
                animKey={animKey}
              />
            ))}
          </View>

          {/* Bouton dés */}
          <View style={s.diceArea}>
            {rollsLeft > 0 ? (
              <Animated.View style={[s.diceWrap, !rolled && { transform: [{ scale: pulse }] }]}>
                <Pressable
                  onPress={rollDice}
                  disabled={!canRoll}
                  style={({ pressed }) => [s.diceBtn, pressed && { opacity: 0.75 }]}
                >
                  <Text style={s.diceBtnText}>
                    {rolling ? '◌ Tirage…' : `Lance les dés (${rollsLeft} essai${rollsLeft > 1 ? 's' : ''})`}
                  </Text>
                </Pressable>
              </Animated.View>
            ) : (
              <Text style={s.noRollsLeft}>Dés épuisés</Text>
            )}
          </View>

          {/* 3 illustrations */}
          <View style={s.illRow}>
            {[0, 1, 2].map(i => {
              const url = protagonist.character_illustrations?.[i]
              return (
                <View key={i} style={s.illSlot}>
                  {url ? (
                    <Image source={{ uri: url }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                  ) : (
                    <View style={s.illFallback} />
                  )}
                </View>
              )
            })}
          </View>

        </View>
      </View>

      {/* ── CTA bas ── */}
      <View style={s.ctaBar}>
        {error ? <Text style={s.errorText}>{error}</Text> : null}
        <Pressable onPress={startAdventure} disabled={!canStart}>
          {({ pressed }) => (
            <View style={[s.signalWrap, pressed && canStart && { opacity: 0.8 }]}>
              {/* Bordure pulsante */}
              <Animated.View style={[
                StyleSheet.absoluteFillObject,
                {
                  borderWidth: 1,
                  borderRadius: 2,
                  borderColor: canStart
                    ? glowAnim.interpolate({ inputRange: [0, 1], outputRange: ['rgba(212,168,76,0.35)', 'rgba(212,168,76,0.9)'] })
                    : '#1e1e22',
                },
              ]} />
              {/* Coins en L */}
              <View style={[s.corner, s.cornerTL, { borderColor: canStart ? '#d4a84c' : '#2a2a30' }]} />
              <View style={[s.corner, s.cornerTR, { borderColor: canStart ? '#d4a84c' : '#2a2a30' }]} />
              <View style={[s.corner, s.cornerBL, { borderColor: canStart ? '#d4a84c' : '#2a2a30' }]} />
              <View style={[s.corner, s.cornerBR, { borderColor: canStart ? '#d4a84c' : '#2a2a30' }]} />
              <View style={s.signalInner}>
                {saving
                  ? <ActivityIndicator color={canStart ? '#d4a84c' : '#9898b4'} />
                  : <Text style={[s.signalText, !canStart && s.signalTextLocked]}>COMMENCER L'AVENTURE</Text>
                }
              </View>
            </View>
          )}
        </Pressable>
      </View>

    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const LEFT_RATIO  = 0.40
const RIGHT_RATIO = 0.60

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  center: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  // ── Layout principal ──
  content: {
    flex: 1,
    flexDirection: 'row',
    paddingBottom: 80, // espace pour la barre CTA
  },

  // ── Colonne gauche ──
  leftCol: {
    width: `${LEFT_RATIO * 100}%`,
    position: 'relative',
    overflow: 'hidden',
  },
  portraitWrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#111',
  },
  portraitGradient: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: '45%',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  portraitFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1f',
  },
  portraitInitial: {
    fontSize: 64,
    fontFamily: FONTS.heading,
    fontWeight: '900',
    color: '#2a2a38',
  },


  // ── Colonne droite ──
  rightCol: {
    width: `${RIGHT_RATIO * 100}%`,
    paddingHorizontal: 16,
    paddingTop: 12,
    justifyContent: 'space-between',
  },

  inventoryHint: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: '#e07090',
    textAlign: 'right',
    marginBottom: 8,
    letterSpacing: 0.3,
  },

  // Stats
  statsBlock: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },

  // Dés
  diceArea: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  diceWrap: {
    width: '100%',
  },
  diceBtn: {
    backgroundColor: 'rgba(212,168,76,0.15)',
    borderWidth: 1,
    borderColor: '#d4a84c',
    borderRadius: 3,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  diceBtnText: {
    fontFamily: FONTS.heading,
    fontSize: 13,
    fontWeight: '700',
    fontStyle: 'italic',
    color: '#d4a84c',
    letterSpacing: 1,
  },
  noRollsLeft: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: '#9898b4',
    fontStyle: 'italic',
  },

  // Illustrations
  illRow: {
    flexDirection: 'row',
    gap: 4,
    height: height * 0.20,
    maxHeight: 160,
  },
  illSlot: {
    flex: 1,
    backgroundColor: '#161618',
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  illFallback: {
    flex: 1,
    backgroundColor: '#161618',
  },

  // CTA
  ctaBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    paddingTop: 12,
    backgroundColor: 'rgba(13,13,13,0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  signalWrap: {
    position: 'relative',
  },
  signalInner: {
    backgroundColor: '#0a0a0c',
    paddingVertical: 15,
    alignItems: 'center',
  },
  signalText: {
    fontFamily: FONTS.heading,
    fontSize: 13,
    fontWeight: '900',
    fontStyle: 'italic',
    color: '#ede9df',
    letterSpacing: 4,
  },
  signalTextLocked: {
    color: '#3a3a48',
  },
  corner: {
    position: 'absolute',
    width: 12,
    height: 12,
  },
  cornerTL: { top: 0,    left: 0,  borderTopWidth: 2,    borderLeftWidth: 2  },
  cornerTR: { top: 0,    right: 0, borderTopWidth: 2,    borderRightWidth: 2 },
  cornerBL: { bottom: 0, left: 0,  borderBottomWidth: 2, borderLeftWidth: 2  },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 },
  errorText: {
    color: '#e05555',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
})
