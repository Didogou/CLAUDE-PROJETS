import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

const supabaseUrl  = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

// SecureStore ne fonctionne pas sur web — fallback localStorage
const storage = Platform.OS === 'web'
  ? {
      getItem:    (key: string) => Promise.resolve(localStorage.getItem(key)),
      setItem:    (key: string, value: string) => Promise.resolve(localStorage.setItem(key, value)),
      removeItem: (key: string) => Promise.resolve(localStorage.removeItem(key)),
    }
  : {
      getItem:    (key: string) => SecureStore.getItemAsync(key),
      setItem:    (key: string, value: string) => SecureStore.setItemAsync(key, value),
      removeItem: (key: string) => SecureStore.deleteItemAsync(key),
    }

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
})
