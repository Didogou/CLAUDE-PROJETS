import { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '@/src/lib/supabase'
import { COLORS } from '@/src/constants/theme'

const BOOK_ID = process.env.EXPO_PUBLIC_BOOK_ID!

export default function SplashScreen() {
  const [status, setStatus] = useState('Chargement…')

  useEffect(() => {
    checkProgress()
  }, [])

  async function checkProgress() {
    try {
      // Vérifier si une partie est en cours (user anonyme identifié par device)
      // Pour l'instant on utilise un identifiant local stocké dans SecureStore
      const { data: progress } = await supabase
        .from('user_progress')
        .select('current_section_id, character')
        .eq('book_id', BOOK_ID)
        .maybeSingle()

      if (progress?.current_section_id) {
        // Partie en cours → reprendre
        setStatus('Reprise de votre aventure…')
        router.replace('/play')
      } else {
        // Pas de partie → intro
        router.replace('/intro')
      }
    } catch {
      // En cas d'erreur réseau → aller à l'intro quand même
      router.replace('/intro')
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HERO</Text>
      <Text style={styles.status}>{status}</Text>
      <ActivityIndicator color={COLORS.accent} style={{ marginTop: 16 }} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title:     { fontSize: 48, fontWeight: 'bold', color: COLORS.accent, letterSpacing: 8, marginBottom: 16 },
  status:    { fontSize: 13, color: COLORS.muted },
})
