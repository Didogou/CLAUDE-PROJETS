import { View, Text, StyleSheet } from 'react-native'
import { COLORS, FONTS } from '@/src/constants/theme'

export default function PlayScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>L'Aventure commence…</Text>
      <Text style={styles.sub}>À venir</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', gap: 12 },
  title:     { fontSize: 22, fontFamily: FONTS.heading, color: COLORS.accent },
  sub:       { fontSize: 14, color: COLORS.muted },
})
