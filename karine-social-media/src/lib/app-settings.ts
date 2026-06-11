import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_ENCOURAGEMENTS,
  type AppSettings,
  type CalorieEncouragements,
  type EncouragementCategory,
} from '@/data/app-settings';

/**
 * Lecture des paramètres globaux de l'app. Lit la singleton row (id=1) de
 * app_settings. Fail-safe : renvoie les défauts si la table n'existe pas encore
 * (migration pas appliquée) ou si la requête échoue. Jamais d'exception remontée
 * pour éviter de casser une page si la DB a un hic.
 */
export async function getAppSettings(): Promise<AppSettings> {
  try {
    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('app_settings')
      .select(
        'patient_relance_cooldown_days, show_calories_in_counter, calorie_tracker_enabled, water_tracker_enabled, calorie_encouragements, about_page_content',
      )
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return DEFAULT_APP_SETTINGS;
    return {
      patientRelanceCooldownDays:
        typeof data.patient_relance_cooldown_days === 'number'
          ? data.patient_relance_cooldown_days
          : DEFAULT_APP_SETTINGS.patientRelanceCooldownDays,
      showCaloriesInCounter:
        typeof data.show_calories_in_counter === 'boolean'
          ? data.show_calories_in_counter
          : DEFAULT_APP_SETTINGS.showCaloriesInCounter,
      calorieTrackerEnabled:
        typeof data.calorie_tracker_enabled === 'boolean'
          ? data.calorie_tracker_enabled
          : DEFAULT_APP_SETTINGS.calorieTrackerEnabled,
      waterTrackerEnabled:
        typeof data.water_tracker_enabled === 'boolean'
          ? data.water_tracker_enabled
          : DEFAULT_APP_SETTINGS.waterTrackerEnabled,
      calorieEncouragements: parseEncouragements(data.calorie_encouragements),
      aboutPageContent:
        typeof data.about_page_content === 'string' && data.about_page_content.length > 0
          ? data.about_page_content
          : DEFAULT_APP_SETTINGS.aboutPageContent,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

/** Parse defensif d'un JSONB encouragements + fallback par categorie. */
function parseEncouragements(raw: unknown): CalorieEncouragements {
  if (!raw || typeof raw !== 'object') return DEFAULT_ENCOURAGEMENTS;
  const cats: EncouragementCategory[] = [
    'debut-journee',
    'bonne-route',
    'objectif-atteint',
  ];
  const out: CalorieEncouragements = { ...DEFAULT_ENCOURAGEMENTS };
  for (const cat of cats) {
    const arr = (raw as Record<string, unknown>)[cat];
    if (Array.isArray(arr) && arr.length > 0 && arr.every((s) => typeof s === 'string')) {
      out[cat] = arr as string[];
    }
  }
  return out;
}
