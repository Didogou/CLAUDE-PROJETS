import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, Dimensions, Platform,
  Animated, Pressable,
} from 'react-native'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { supabase } from '@/src/lib/supabase'
import { COLORS } from '@/src/constants/theme'
import type { Book, IntroFrame } from '@/src/types'

const BOOK_ID   = process.env.EXPO_PUBLIC_BOOK_ID!
const { width, height } = Dimensions.get('window')

const DURATION_MAP: Record<string, number> = {
  flash:  1.5,
  court:  2.5,
  normal: 4,
  pause:  5,
  long:   7,
}

function parseDuration(d: unknown): number {
  if (typeof d === 'number') return d
  if (typeof d === 'string' && DURATION_MAP[d]) return DURATION_MAP[d]
  return 4
}

export default function IntroScreen() {
  const [book, setBook]       = useState<Book | null>(null)
  const [frames, setFrames]   = useState<IntroFrame[]>([])
  const [current, setCurrent] = useState(0)
  const [ready, setReady]     = useState(false)

  // Animations
  const imageOpacity = useRef(new Animated.Value(0)).current
  const textOpacity  = useRef(new Animated.Value(0)).current
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadBook()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  useEffect(() => {
    if (!ready || frames.length === 0) return
    showFrame(current)
  }, [current, ready])

  async function loadBook() {
    const { data } = await supabase
      .from('books')
      .select('id, title, theme, intro_sequence, intro_text, intro_audio_url')
      .eq('id', BOOK_ID)
      .single()

    if (!data) return
    setBook(data as Book)

    const seq: IntroFrame[] = data.intro_sequence ?? []
    if (seq.length === 0) {
      // Pas d'intro définie → aller directement à la création de personnage
      router.replace('/create')
      return
    }
    setFrames(seq.sort((a, b) => a.order - b.order))
    setReady(true)
  }

  const useND = Platform.OS !== 'web'

  function showFrame(idx: number) {
    // Reset opacités
    imageOpacity.setValue(0)
    textOpacity.setValue(0)

    // Fondu entrant image
    Animated.timing(imageOpacity, {
      toValue: 1, duration: 1200, useNativeDriver: useND,
    }).start(() => {
      // Puis texte apparaît
      Animated.timing(textOpacity, {
        toValue: 1, duration: 800, useNativeDriver: useND,
      }).start()
    })

    // Avance automatiquement après duration (en secondes) + temps d'animation
    const frame = frames[idx]
    const delay = (parseDuration(frame.duration) * 1000) + 2000
    timerRef.current = setTimeout(() => advance(), delay)
  }

  function advance() {
    if (timerRef.current) clearTimeout(timerRef.current)
    const next = current + 1
    if (next >= frames.length) {
      // Fin de l'intro → fondu sortant puis création personnage
      Animated.parallel([
        Animated.timing(imageOpacity, { toValue: 0, duration: 800, useNativeDriver: useND }),
        Animated.timing(textOpacity,  { toValue: 0, duration: 600, useNativeDriver: useND }),
      ]).start(() => router.replace('/create'))
    } else {
      // Fondu sortant puis frame suivante
      Animated.parallel([
        Animated.timing(imageOpacity, { toValue: 0, duration: 600, useNativeDriver: useND }),
        Animated.timing(textOpacity,  { toValue: 0, duration: 400, useNativeDriver: useND }),
      ]).start(() => setCurrent(next))
    }
  }

  function skip() {
    if (timerRef.current) clearTimeout(timerRef.current)
    Animated.parallel([
      Animated.timing(imageOpacity, { toValue: 0, duration: 400, useNativeDriver: useND }),
      Animated.timing(textOpacity,  { toValue: 0, duration: 300, useNativeDriver: useND }),
    ]).start(() => router.replace('/create'))
  }

  if (!ready || frames.length === 0) {
    return <View style={styles.container} />
  }

  const frame = frames[current]

  return (
    <Pressable onPress={advance} style={styles.container}>

        {/* Image cinématique plein écran */}
        {frame.image_url ? (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: imageOpacity }]}>
            <Image
              source={{ uri: frame.image_url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={0}
            />
            {/* Dégradé bas pour le texte */}
            <View style={styles.gradient} />
          </Animated.View>
        ) : (
          <Animated.View style={[StyleSheet.absoluteFill, styles.noImage, { opacity: imageOpacity }]} />
        )}

        {/* Texte narratif — overlay cinématique */}
        {frame.narrative_text ? (
          <Animated.View style={[styles.textContainer, { opacity: textOpacity }]}>
            <Text style={styles.narrativeText}>{frame.narrative_text}</Text>
          </Animated.View>
        ) : null}

        {/* Indicateur de progression */}
        <View style={styles.dotsContainer}>
          {frames.map((_, i) => (
            <View key={i} style={[styles.dot, i === current && styles.dotActive]} />
          ))}
        </View>

        {/* Bouton Passer */}
        <Pressable onPress={skip} style={styles.skipButton}>
          <Text style={styles.skipText}>Passer ›</Text>
        </Pressable>

      </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#000',
  },
  noImage: {
    backgroundColor: COLORS.background,
  },
  gradient: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: height * 0.45,
    backgroundColor: 'transparent',
  },
  textContainer: {
    position: 'absolute', bottom: 120, left: 0, right: 0,
    paddingHorizontal: 32, paddingVertical: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  narrativeText: {
    color: COLORS.foreground,
    fontSize: 17,
    lineHeight: 28,
    fontFamily: 'Georgia',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  dotsContainer: {
    position: 'absolute', bottom: 72, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: {
    backgroundColor: COLORS.accent, width: 18,
  },
  skipButton: {
    position: 'absolute', top: 56, right: 24,
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  skipText: {
    color: 'rgba(255,255,255,0.6)', fontSize: 13,
  },
})
